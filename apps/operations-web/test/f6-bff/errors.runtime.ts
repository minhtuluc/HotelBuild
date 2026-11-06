import { f6Handler } from '../../src/app/api/session/sys/f6-route';
import { BEARER, browser, done, errorBody, jsonOf, startFake, type Reply } from './harness';

const logged: string[] = [];
const keep = (...args: unknown[]): void => {
  logged.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
};
console.warn = keep;
console.error = keep;
process.stderr.write = (chunk: string | Uint8Array): boolean => {
  logged.push(String(chunk));
  return true;
};

const fake = await startFake();
interface Case {
  id: string;
  method: string;
  path: string;
  body?: unknown;
  tag?: string;
  reply: Reply;
}
const approve: Omit<Case, 'reply'> = {
  id: 'moves.approve',
  method: 'POST',
  path: '/room-moves/mv1/approve',
  body: { compensationAmount: 0, transportCost: 0, pinToken: 'synthetic-pin-token-0001' },
  tag: '"3"',
};
const execute: Omit<Case, 'reply'> = {
  id: 'moves.execute',
  method: 'POST',
  path: '/room-moves/mv1/execute',
  body: { pinToken: 'synthetic-pin-token-0001' },
  tag: '"3"',
};
const refund: Omit<Case, 'reply'> = {
  id: 'refunds.approve',
  method: 'POST',
  path: '/refund-requests/r1/approve',
  body: { approvedAmount: 1, pinToken: 'synthetic-pin-token-0001' },
};
const err = (
  status: number,
  code: string,
  headers: Record<string, string> = {},
  extra: Record<string, unknown> = {},
): Reply => ({ status, headers, body: errorBody(code, extra) });
const cases: Case[] = [
  { ...approve, reply: err(403, 'E_OVER_APPROVAL_REQUIRED') },
  { ...execute, reply: err(401, 'E_AUTH_PIN_REQUIRED') },
  {
    ...execute,
    reply: err(403, 'E_AUTH_PIN_LOCKED', { 'retry-after': '900' }, { retryAfterSeconds: 900 }),
  },
  { ...execute, reply: err(409, 'E_INV_ROOM_TAKEN') },
  { ...execute, reply: err(409, 'E_OVER_NO_CONSENT') },
  {
    id: 'merges.execute',
    method: 'POST',
    path: '/room-merges/mg1/execute',
    tag: '"2"',
    reply: err(409, 'E_OVER_MERGE_GENDER'),
  },
  {
    id: 'cases.resolve',
    method: 'POST',
    path: '/overbooking-cases/k1/resolve',
    body: { resolutionNote: 'ok' },
    tag: '"3"',
    reply: err(409, 'E_OVER_CASE_DEADLINE_PASSED'),
  },
  { ...execute, reply: err(412, 'E_GEN_VERSION_CONFLICT') },
  { ...execute, reply: err(428, 'E_GEN_PRECONDITION_REQUIRED') },
  {
    ...execute,
    reply: err(409, 'E_SYS_REQUEST_IN_PROGRESS', { 'retry-after': '3' }, { retryAfterSeconds: 3 }),
  },
  { ...refund, reply: err(403, 'E_PAY_SELF_APPROVAL') },
  { ...execute, reply: err(500, 'E_SYS_INTERNAL') },
];
const results: Array<{ status: number; code: unknown; retry: string | null; clean: boolean }> = [];
for (const item of cases) {
  fake.reply = () => item.reply;
  const response = await f6Handler(item.id)(
    browser(item.method, item.path, {
      body: item.body,
      ...(item.tag === undefined ? {} : { tag: item.tag }),
    }),
  );
  const body = await jsonOf(response);
  results.push({
    status: response.status,
    code: body.code,
    retry: response.headers.get('retry-after'),
    clean:
      !JSON.stringify(body).includes('synthetic-private') &&
      response.headers.get('set-cookie') === null,
  });
}
// Chi tiết lỗi chỉ qua danh sách trắng theo tuyến; `issue` phải dạng mã VIẾT_HOA.
fake.reply = () =>
  err(
    422,
    'E_GEN_VALIDATION_FAILED',
    {},
    {
      details: [
        { field: 'reason', issue: 'REQUIRED' },
        { field: 'pinToken', issue: 'LEAK' },
        { field: 'reason', issue: 'free text with spaces' },
        { field: 'email', issue: 'PII' },
      ],
    },
  );
const detailed = await jsonOf(
  await f6Handler('merges.approve')(
    browser('POST', '/room-merges/mg1/approve', { body: { reason: 'ok' }, tag: '"2"' }),
  ),
);
await fake.close();
const logs = logged.join('\n');
done({
  results,
  details: detailed.details,
  leaked: ['synthetic-pin-token', 'synthetic-access', BEARER, 'synthetic-private'].filter(
    (secret) => logs.includes(secret),
  ),
  logLines: logged.length,
});
