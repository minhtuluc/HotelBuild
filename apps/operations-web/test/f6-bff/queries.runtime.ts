import { F6_CATALOGUE, f6Handler, resolveF6 } from '../../src/app/api/session/sys/f6-route';
import { browser, done, sample, startFake } from './harness';

const queryOf = (id: string) => {
  const entry = F6_CATALOGUE.find((item) => item.id === id);
  const hit =
    entry === undefined
      ? undefined
      : resolveF6(
          [entry],
          entry.method,
          `/api/session/sys${entry.pattern.replaceAll(/:\w+/g, 'x1')}`,
        );
  const query = hit?.route.query;
  if (query === undefined) throw new Error(`no query for ${id}`);
  return query;
};
const fails = (id: string, input: Record<string, string>): boolean => {
  try {
    queryOf(id)(input);
    return false;
  } catch {
    return true;
  }
};

const fake = await startFake(() => ({ status: 200, body: sample.refundList }));
const refunds = f6Handler('refunds.list');
fake.seen.length = 0;
const forwarded = await refunds(browser('GET', '/refund-requests?status=PENDING&limit=5'));
const forwardedUrl = fake.seen[0]?.url ?? '';
const duplicate = await refunds(browser('GET', '/refund-requests?limit=1&limit=2'));
const unknownKey = await refunds(browser('GET', '/refund-requests?role=OWNER'));
const noQueryRoute = await f6Handler('syncStatus.get')(
  browser('GET', '/channels/c1/sync-status?x=1'),
);
await fake.close();
done({
  caseList: queryOf('cases.list')({ limit: '10', status: 'OPEN', overdueOnly: 'true' }),
  booleanFalseRejected: fails('cases.list', { overdueOnly: 'false' }),
  booleanJunkRejected: fails('cases.list', { overdueOnly: '1' }),
  includeFalseRejected: fails('cases.get', { includeCandidates: 'false' }),
  includeTrue: queryOf('cases.get')({ includeCandidates: 'true' }),
  unknownKeyRejected: fails('cases.list', { debug: 'x' }),
  badLimitRejected: fails('cases.list', { limit: '1000' }),
  badKeyRejected: fails('options.get', { idempotencyKey: 'not-a-uuid' }),
  optionsPassThrough: queryOf('options.get')({ overbookingCaseId: 'k1' }),
  forwardedStatus: forwarded.status,
  forwardedUrl,
  duplicateStatus: duplicate.status,
  unknownKeyStatus: unknownKey.status,
  noQueryRouteStatus: noQueryRoute.status,
  upstreamCalls: fake.seen.length,
});
