/** HB-120 AC10: artefact OpenAPI sinh lại khớp bản commit, đủ tuyến F6 và không phá bản nền. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSION, serializeDocument } from '../../src/openapi/generate.js';
import { asObject, documentJson, operationOf, readJsonFile } from './fixtures.js';

const COMMITTED = new URL('../../openapi.json', import.meta.url);
const BASELINE = new URL('../../openapi.baseline.json', import.meta.url);

const NEW_ROUTES = [
  ['post', '/api/v1/channels/{channelId}/sync'],
  ['put', '/api/v1/channels/{channelId}/mappings'],
  ['post', '/api/v1/channels/{channelId}/sales-closure'],
  ['get', '/api/v1/channels/{channelId}/ota-bookings'],
  ['get', '/api/v1/channels/{channelId}/sync-status'],
  ['get', '/api/v1/channels/{channelId}/outbox-deliveries'],
  ['post', '/api/v1/channels/{channelId}/outbox-deliveries/{deliveryId}/retry'],
  ['post', '/api/v1/channels/{channelId}/ota-bookings/{bookingId}/duplicate-flag'],
  ['post', '/api/v1/integrations/ota/{channel}/bookings'],
  ['get', '/api/v1/overbooking-cases'],
  ['get', '/api/v1/overbooking-cases/{caseId}'],
  ['post', '/api/v1/overbooking-cases/{caseId}/relocation-plan'],
  ['post', '/api/v1/overbooking-cases/{caseId}/resolve'],
  ['get', '/api/v1/room-moves/{roomMoveId}'],
  ['post', '/api/v1/room-moves'],
  ['post', '/api/v1/room-moves/{roomMoveId}/approve'],
  ['post', '/api/v1/room-moves/{roomMoveId}/execute'],
  ['post', '/api/v1/room-moves/{roomMoveId}/compensation-payments'],
  ['get', '/api/v1/room-moves/{roomMoveId}/compensation-payments'],
  ['post', '/api/v1/room-merges'],
  ['get', '/api/v1/room-merges/{roomMergeId}'],
  ['post', '/api/v1/room-merges/{roomMergeId}/consent'],
  ['post', '/api/v1/room-merges/{roomMergeId}/approve'],
  ['post', '/api/v1/room-merges/{roomMergeId}/execute'],
  ['get', '/api/v1/bookings/{bookingId}/relocation-options'],
  ['get', '/api/v1/overbooking-alerts'],
] as const;

describe('F6 openapi', () => {
  it('published-paths', () => {
    const committed = readFileSync(COMMITTED, 'utf8');
    expect(committed).toBe(serializeDocument());
    expect(CONTRACT_VERSION).toBe('1.0.0');

    const doc = documentJson();
    for (const [method, path] of NEW_ROUTES) {
      expect(operationOf(doc, path, method), `${method} ${path}`).toBeDefined();
    }
    // `GET /channels` tái sử dụng tuyến F3 đã phát hành.
    expect(operationOf(doc, '/api/v1/channels', 'get')).toBeDefined();

    // 0 phá vỡ: mọi path + method của bản nền vẫn còn.
    const baseline = readJsonFile(BASELINE);
    const baselinePaths = asObject(baseline.paths) ?? {};
    const currentPaths = asObject(doc.paths) ?? {};
    expect(Object.keys(baselinePaths).length).toBeGreaterThan(0);
    for (const [path, item] of Object.entries(baselinePaths)) {
      const current = asObject(currentPaths[path]);
      expect(current, path).toBeDefined();
      for (const method of Object.keys(asObject(item) ?? {})) {
        expect(asObject(current)?.[method], `${method} ${path}`).toBeDefined();
      }
    }
  });
});
