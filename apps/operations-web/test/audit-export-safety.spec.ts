import { expect, test } from 'vitest';
import type { AuditLogEntry } from '@pinehill/contracts';
import { EMPTY_AUDIT_FILTERS, buildAuditQuery, toCsv } from '../src/lib/audit-log';
const row: AuditLogEntry = {
  id: 'a1',
  actorId: 'u1',
  action: 'UPDATE',
  entityType: 'SystemSetting',
  entityId: 'pricing.maxDiscountPct',
  reason: 'synthetic reason',
  beforeJson: null,
  afterJson: null,
  createdAt: '2026-10-12T00:00:00Z',
};
test('CSV cells beginning spreadsheet formulas are emitted as text and no raw JSON is exported', () => {
  for (const value of ['=1+1', '+cmd', '-cmd', '@SUM(1)', '\t=1+1', '\r=1+1'])
    expect(toCsv([{ ...row, reason: value }])).toContain("'" + value);
  expect(toCsv([{ ...row, beforeJson: 'synthetic-raw-secret' }])).not.toContain(
    'synthetic-raw-secret',
  );
});
test('date inputs are VN civil time regardless of browser TZ; impossible dates are rejected', () => {
  expect(
    buildAuditQuery({ ...EMPTY_AUDIT_FILTERS, from: '2026-11-12T00:00', to: '2026-11-13T00:00' }),
  ).toMatchObject({ from: '2026-11-11T17:00:00.000Z', to: '2026-11-12T17:00:00.000Z' });
  expect(() => buildAuditQuery({ ...EMPTY_AUDIT_FILTERS, from: '2026-02-30T00:00' })).toThrow();
});
