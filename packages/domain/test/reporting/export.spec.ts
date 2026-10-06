import { expect, test } from 'vitest';

test('HB161 public reporting subpath exports the shared metrics and fraction presenter', async () => {
  const module = await import('@pinehill/domain/reporting');
  expect(module.calculateReportingMetrics).toBeTypeOf('function');
  expect(module.formatFraction).toBeTypeOf('function');
});
