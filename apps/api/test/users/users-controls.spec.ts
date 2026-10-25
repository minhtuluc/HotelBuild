import { expect, test } from 'vitest';
import { AuditWriter } from '../../src/infrastructure/audit/audit-writer.js';
import {
  businessDb,
  clock,
  id,
  rows,
  state,
  assertAccess,
  changes,
  login,
  username,
  assertPassword,
  assertAudit,
  auditCount,
  underUserLocks,
} from './users-oracle.fixture.js';

// Quality controls for the oracle helpers, NOT a reference implementation of the missing users UC.
test('state and password assertions read real credentials/sessions without exposing them', async () => {
  await login('staff-a');
  const saved = await state('staff-a');
  expect(saved.user.role).toBe('FRONT_DESK');
  expect(saved.sessions).toHaveLength(1);
  await assertPassword(username('staff-a'), 'Synthetic-HB016-password!');
  await assertAccess('staff-a', changes());
  await expect(assertAccess('staff-a', changes('MANAGER'))).rejects.toThrow();
  await expect(assertAccess('staff-a', changes('FRONT_DESK', false))).rejects.toThrow();
  await expect(assertAccess('staff-a', changes('FRONT_DESK', true, []))).rejects.toThrow();
});
test('audit helper excludes auth events and rejects wrong before/after, actor, or secrets', async () => {
  await login('staff-a');
  const count = await auditCount();
  const writer = new AuditWriter(clock);
  const entry = {
    actor: { id: id('owner-a'), role: 'OWNER', ip: null, correlationId: 'hb016-control' },
    action: 'HB016_ORACLE_CONTROL',
    entityType: 'User',
    entityId: id('staff-a'),
    beforeJson: { role: 'FRONT_DESK' },
    afterJson: { role: 'MANAGER' },
    reason: 'synthetic helper control',
  };
  for (const defect of [
    { beforeJson: { role: 'ACCOUNTANT' } },
    { afterJson: { role: 'ACCOUNTANT' } },
    { afterJson: { memo: 'MANAGER' } },
    { actor: { ...entry.actor, id: id('admin') } },
    { afterJson: { role: 'MANAGER', password_hash: 'synthetic hash' } },
  ]) {
    await businessDb().$transaction((tx) => writer.record(tx, { ...entry, ...defect }));
    await expect(
      assertAudit(id('staff-a'), { role: 'FRONT_DESK' }, { role: 'MANAGER' }),
    ).rejects.toThrow();
  }
  await businessDb().$transaction((tx) => writer.record(tx, entry));
  await assertAudit(id('staff-a'), { role: 'FRONT_DESK' }, { role: 'MANAGER' });
  expect(await auditCount()).toBe(count + 6);
});
test('race barrier observes two independent runtime transactions at actual database locks', async () => {
  const results = await underUserLocks(['staff-a', 'staff-b'], () => [
    businessDb().users.update({
      where: { id: id('staff-a') },
      data: { full_name: 'Synthetic control A' },
    }),
    businessDb().users.update({
      where: { id: id('staff-b') },
      data: { full_name: 'Synthetic control B' },
    }),
  ]);
  expect(results).toHaveLength(2);
  expect(
    (await rows('SELECT full_name FROM users WHERE id=$1', [id('staff-a')]))[0]!.full_name,
  ).toBe('Synthetic control A');
});
