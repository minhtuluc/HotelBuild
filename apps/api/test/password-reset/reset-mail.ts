import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { Writable } from 'node:stream';
import { expect } from 'vitest';
import { z } from 'zod';
import { LoggerModule, PARAMS_PROVIDER_TOKEN, type Params } from 'nestjs-pino';
import type { DynamicModule } from '@nestjs/common';

const container = 'hb028-mail-' + randomUUID();
export const guestBase = `https://${container}.example.invalid`;
export const email = 'synthetic-hb028@example.invalid';
export let smtpUrl = '';
let apiUrl = '',
  created = false,
  offline = false;
let relay: Server | undefined;
const connections = new Set<Socket>();
const records: string[] = [];
const sink = new Writable({
  write(chunk, _encoding, done) {
    records.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
    done();
  },
});
export const logs = () => records.join('');
export const clearLogs = () => {
  records.length = 0;
};
function docker(...args: string[]) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw new Error('HB028 owned Mailpit operation failed');
  return result.stdout.trim();
}
export async function startMail() {
  docker(
    'run',
    '-d',
    '--name',
    container,
    '--publish',
    '127.0.0.1::1025',
    '--publish',
    '127.0.0.1::8025',
    'axllent/mailpit:v1',
  );
  created = true;
  const upstream = new URL('smtp://' + docker('port', container, '1025/tcp'));
  relay = createServer((client) => {
    connections.add(client);
    client.on('close', () => connections.delete(client));
    client.on('error', () => client.destroy());
    if (offline) {
      client.end('421 Synthetic SMTP service unavailable\r\n');
      return;
    }
    const remote = connect({ host: upstream.hostname, port: Number(upstream.port) });
    connections.add(remote);
    remote.on('close', () => {
      connections.delete(remote);
      client.destroy();
    });
    remote.on('error', () => client.destroy());
    client.on('close', () => remote.destroy());
    client.pipe(remote);
    remote.pipe(client);
  });
  await new Promise<void>((resolve, reject) => {
    relay!.once('error', () => reject(new Error('HB028 SMTP relay unavailable')));
    relay!.listen(0, '127.0.0.1', resolve);
  });
  const address = relay.address();
  if (address === null || typeof address === 'string')
    throw new Error('HB028 invalid relay listener');
  smtpUrl = `smtp://127.0.0.1:${address.port}`;
  apiUrl = 'http://' + docker('port', container, '8025/tcp');
  await ready();
}
async function ready() {
  for (let i = 0; i < 100; i++) {
    // Only readiness connection failures are retried; unavailable SMTP never becomes a skipped test.
    try {
      if ((await fetch(apiUrl + '/api/v1/messages')).ok) return;
    } catch {
      /* bounded startup retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('HB028 Mailpit unavailable');
}
export async function resetMail() {
  offline = false;
  const response = await fetch(apiUrl + '/api/v1/messages', { method: 'DELETE' });
  expect(response.ok).toBe(true);
}
export function stopSmtp() {
  offline = true;
  for (const socket of connections) socket.destroy();
}
export async function closeMail() {
  for (const socket of connections) socket.destroy();
  if (relay?.listening)
    await new Promise<void>((resolve, reject) =>
      relay!.close((error) =>
        error ? reject(new Error('HB028 relay cleanup failed')) : resolve(),
      ),
    );
  if (created) {
    docker('rm', '--force', container);
    created = false;
  }
}
export async function mailList() {
  const response = await fetch(apiUrl + '/api/v1/messages');
  expect(response.ok).toBe(true);
  return z.object({ messages: z.array(z.object({ ID: z.string() })) }).parse(await response.json())
    .messages;
}
export const mailCount = async () => (await mailList()).length;
export function tokenFromText(text: string) {
  const links = [...new Set(text.match(/https?:\/\/[^\s<>"']+/g) ?? [])].map(
    (value) => new URL(value),
  );
  const candidates = links.flatMap((link) => {
    const values = [
      ...link.searchParams.values(),
      ...link.pathname.split('/').map((value) => decodeURIComponent(value)),
    ];
    return [...new Set(values)]
      .filter((value) => /^[a-f\d]{64}$/i.test(value) || /^[A-Za-z0-9_-]{43}=?$/.test(value))
      .map((token) => ({ token, link }));
  });
  expect(candidates.length).toBe(1);
  const value = candidates[0]!;
  expect(value.link.origin === guestBase).toBe(true);
  expect(
    Buffer.from(value.token, /^[a-f\d]{64}$/i.test(value.token) ? 'hex' : 'base64url').length,
  ).toBe(32);
  // Token query name/path is internal; only configured origin and32-byte opaque token are prescribed.
  return { token: value.token, link: value.link.href };
}
export async function tokenFromMail() {
  let messages = await mailList();
  for (let i = 0; messages.length === 0 && i < 100; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    messages = await mailList();
  }
  expect(messages.length).toBe(1);
  const response = await fetch(apiUrl + '/api/v1/message/' + encodeURIComponent(messages[0]!.ID));
  expect(response.ok).toBe(true);
  const message = z
    .object({ Text: z.string(), HTML: z.string(), To: z.array(z.object({ Address: z.string() })) })
    .parse(await response.json());
  expect(message.To.map((value) => value.Address)).toEqual([email]);
  return tokenFromText(message.Text || message.HTML.replaceAll('&amp;', '&'));
}
// Keep the production Pino params (serializers/redaction/level); change only its output destination.
function isLoggingParams(value: unknown): value is Params {
  return typeof value === 'object' && value !== null && 'pinoHttp' in value;
}
export function captureLogger(module: DynamicModule): DynamicModule {
  if (module.module !== LoggerModule) throw new Error('HB028 wrong logger module');
  return {
    ...module,
    providers: (module.providers ?? []).map((provider) => {
      if (
        typeof provider !== 'object' ||
        !('provide' in provider) ||
        provider.provide !== PARAMS_PROVIDER_TOKEN ||
        !('useValue' in provider)
      )
        return provider;
      const value: unknown = provider.useValue;
      if (!isLoggingParams(value)) throw new Error('HB028 invalid logging params');
      const params = value,
        options = params.pinoHttp;
      if (!options || Array.isArray(options) || 'write' in options)
        throw new Error('HB028 unexpected production logger params');
      return { ...provider, useValue: { ...params, pinoHttp: [options, sink] } satisfies Params };
    }),
  };
}
// Actual SMTP for helper control only; never implements guest reset or substitutes the Mailer adapter.
export async function sendControlMail(text: string) {
  const address = new URL(smtpUrl);
  const socket = connect({ host: address.hostname, port: Number(address.port) });
  let buffer = '',
    waiting: { resolve: (line: string) => void; reject: (err: Error) => void } | undefined;
  socket.setTimeout(5000, () => socket.destroy(new Error('HB028 control SMTP timeout')));
  socket.on('data', (chunk) => {
    buffer += chunk.toString();
    drain();
  });
  socket.on('error', () => waiting?.reject(new Error('HB028 control SMTP connection failed')));
  function drain() {
    if (!waiting) return;
    const match = /^([\s\S]*?\r\n)/.exec(buffer);
    if (!match) return;
    const line = match[1]!;
    buffer = buffer.slice(line.length);
    if (/^\d{3} /.test(line)) {
      const resolve = waiting.resolve;
      waiting = undefined;
      resolve(line);
    } else drain();
  }
  const reply = () =>
    new Promise<string>((resolve, reject) => {
      waiting = { resolve, reject };
      drain();
    });
  const command = async (line: string, code: string) => {
    socket.write(line + '\r\n');
    expect((await reply()).startsWith(code)).toBe(true);
  };
  try {
    expect((await reply()).startsWith('220')).toBe(true);
    await command('EHLO oracle.invalid', '250');
    await command('MAIL FROM:<oracle@example.invalid>', '250');
    await command(`RCPT TO:<${email}>`, '250');
    await command('DATA', '354');
    await command(
      `From: oracle@example.invalid\r\nTo: ${email}\r\nSubject: Synthetic HB028 control\r\n\r\n${text}\r\n.`,
      '250',
    );
    await command('QUIT', '221');
  } finally {
    socket.destroy();
  }
}
