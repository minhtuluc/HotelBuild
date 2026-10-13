import { expect, test } from 'vitest';
import { parseCommand } from '../../src/app/(ops)/admin-commands/intent';
import { assertAcknowledgedProjection } from '../../src/app/(ops)/admin-commands/projection';
import { command, policyCommand, network, data, plan, policy } from './fixture';
const signal = () => new AbortController().signal;
test('rate config parser binds exact canonical policy command and safe strong version', () => {
  expect(parseCommand(policyCommand, 'rate-config')).toEqual(policyCommand);
  for (const tag of ['W/"1"', '"0"', '"9007199254740992"'])
    expect(() => parseCommand({ ...command, tag }, 'rate-config')).toThrow();
  expect(() => parseCommand({ ...command, targetId: '../auth' }, 'rate-config')).toThrow();
});
test('rate config ports read global admin/catalogues without unrelated property endpoints', async () => {
  const s = network();
  const read = await s.ports.read(signal());
  expect(read).toEqual(data);
  expect(s.calls.map((call) => call.path).sort()).toEqual([
    '/api/session/sys/cancellation-policies',
    '/api/session/sys/rate-plans/admin',
  ]);
});
test('plan PUT expects204 and persists exact key/tag/body plus CSRF marker', async () => {
  const s = network();
  expect(await s.ports.write(command, 'synthetic-key', signal())).toEqual({
    kind: 'rate-plan-put',
    id: plan.id,
    priorVersion: 1,
  });
  expect(s.calls[0]).toMatchObject({
    method: 'PUT',
    key: 'synthetic-key',
    tag: '"1"',
    marker: '1',
    body: command.body,
  });
  s.status(200);
  await expect(s.ports.write(command, 'synthetic-key', signal())).rejects.toMatchObject({
    kind: 'protocol',
  });
});
test('policy PUT keeps canonical tiers and rejects a nonadvancing receipt', async () => {
  const s = network();
  expect(await s.ports.write(policyCommand, 'synthetic-key', signal())).toEqual({
    kind: 'policy-put',
    data: { ...policy, version: 2 },
  });
  expect(s.calls[0]?.body).toEqual(policyCommand.body);
  s.version(1);
  await expect(s.ports.write(policyCommand, 'synthetic-key', signal())).rejects.toMatchObject({
    kind: 'protocol',
  });
});
test('ACK readback must advance plan version or include at least the policy receipt version', () => {
  expect(() =>
    assertAcknowledgedProjection(data, { kind: 'rate-plan-put', id: plan.id, priorVersion: 1 }),
  ).toThrow();
  expect(() =>
    assertAcknowledgedProjection(
      { ...data, ratePlans: [{ ...plan, version: 2 }] },
      { kind: 'rate-plan-put', id: plan.id, priorVersion: 1 },
    ),
  ).not.toThrow();
  expect(() =>
    assertAcknowledgedProjection(data, { kind: 'policy-put', data: { ...policy, version: 2 } }),
  ).toThrow();
});
