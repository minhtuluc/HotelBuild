/**
 * Cổng gọi use case phát hiện + tiện ích HTTP/khẳng định cho hai file khoá HB-126.
 *
 * Use case do giai đoạn B hiện thực ở `apps/api/src/modules/over/detection/index.ts` và **phải** xuất
 * `createOverbookingDetection(deps)`. Specifier được dựng động nên file test biên dịch và chạy được
 * ngay từ giai đoạn A; khi use case chưa có, mỗi ca dừng ở thông điệp "GIAI ĐOẠN A ĐỎ CÓ CHỦ ĐÍCH"
 * thay vì lỗi phân giải module của cả file.
 *
 * Đây là test seam có chủ đích (HB-127 gọi cùng use case từ worker), không phải wrapper trang trí.
 */
import { expect } from 'vitest';
import request from 'supertest';
import { errorBodySchema } from '@pinehill/contracts';
import { http, db, clock } from './fixture.js';
import {
  DETECTION_PATH,
  DETECTION_SPECIFIER,
  LADDER_ORDER,
  alertListSchema,
  caseDetailSchema,
  caseListSchema,
  scanResultSchema,
  type Candidate,
  type CaseDetail,
  type CaseList,
  type DetectionFactory,
  type OverbookingDetection,
  type ScanResult,
} from './contract.js';

export * from './contract.js';
export * from './fixture.js';
export * from './scenario.js';

export const CASES_ROUTE = '/api/v1/overbooking-cases';
export const ALERTS_ROUTE = '/api/v1/overbooking-alerts';

function notImplemented(detail: string): Error {
  return new Error(
    `GIAI ĐOẠN A ĐỎ CÓ CHỦ ĐÍCH: ${DETECTION_PATH} chưa hiện thực use case phát hiện quá tải ` +
      `(HB-126 giai đoạn B phải xuất createOverbookingDetection) — ${detail}`,
  );
}

function isFactoryModule(
  value: unknown,
): value is { createOverbookingDetection: DetectionFactory } {
  if (typeof value !== 'object' || value === null) return false;
  const factory: unknown = Reflect.get(value, 'createOverbookingDetection');
  return typeof factory === 'function';
}

let engine: OverbookingDetection | null = null;

/** Một instance cho cả file: quét đồng thời vẫn dùng cùng Prisma pool nên khoá DB mới là thứ phân xử. */
export async function detection(): Promise<OverbookingDetection> {
  if (engine !== null) return engine;
  let loaded: unknown;
  // Ngoại lệ có chủ đích: giai đoạn A phải biên dịch **trước khi** module tồn tại, nên không thể dùng
  // `import` tĩnh (TypeScript sẽ báo thiếu module và cả file test đỏ vì lỗi import, không phải hành vi).
  try {
    loaded = await import(/* @vite-ignore */ DETECTION_SPECIFIER);
  } catch {
    throw notImplemented('không nạp được module use case');
  }
  if (!isFactoryModule(loaded))
    throw notImplemented('module không xuất createOverbookingDetection');
  engine = loaded.createOverbookingDetection({ db, clock });
  return engine;
}

export async function runScan(propertyIds?: readonly string[]): Promise<ScanResult> {
  const instance = await detection();
  const result = await instance.scan(propertyIds === undefined ? undefined : { propertyIds });
  return scanResultSchema.parse(result);
}

export const rawCases = (
  token: string,
  query: Record<string, string | number> = {},
): request.Test => http().get(CASES_ROUTE).query(query).set('Authorization', `Bearer ${token}`);

export async function listCases(
  token: string,
  query: Record<string, string | number> = {},
): Promise<CaseList> {
  const response = await http()
    .get(CASES_ROUTE)
    .query(query)
    .set('Authorization', `Bearer ${token}`);
  expect(response.status, `GET ${CASES_ROUTE} → ${JSON.stringify(response.body)}`).toBe(200);
  return caseListSchema.parse(response.body);
}

export async function readCase(
  token: string,
  caseId: string,
  query: Record<string, string | number> = {},
): Promise<CaseDetail> {
  const response = await http()
    .get(`${CASES_ROUTE}/${caseId}`)
    .query(query)
    .set('Authorization', `Bearer ${token}`);
  expect(response.status, `GET ${CASES_ROUTE}/${caseId} → ${JSON.stringify(response.body)}`).toBe(
    200,
  );
  return caseDetailSchema.parse(response.body);
}

export const alertRows = (token: string, query: Record<string, string | number> = {}) =>
  http().get(ALERTS_ROUTE).query(query).set('Authorization', `Bearer ${token}`);

export async function listAlerts(token: string, query: Record<string, string | number> = {}) {
  const response = await alertRows(token, query);
  expect(response.status, `GET ${ALERTS_ROUTE} → ${JSON.stringify(response.body)}`).toBe(200);
  return alertListSchema.parse(response.body);
}

export const errorCode = (response: { body: unknown }) => errorBodySchema.parse(response.body).code;

type RankKey = readonly [number, number, number, bigint];

function rankKey(candidate: Candidate): RankKey {
  return [
    candidate.priorityGroup === 'WEAK' ? 0 : 1,
    candidate.keepScore,
    -Date.parse(candidate.createdAt),
    BigInt(candidate.bookingSeq),
  ];
}

function compareKeys(left: RankKey, right: RankKey): number {
  if (left[0] !== right[0]) return left[0] - right[0];
  if (left[1] !== right[1]) return left[1] - right[1];
  if (left[2] !== right[2]) return left[2] - right[2];
  return left[3] < right[3] ? -1 : left[3] > right[3] ? 1 : 0;
}

/** Thứ tự BR-OVER-11/12: nhóm WEAK trước, rồi keepScore ↑ → createdAt ↓ → Booking.seq ↑. */
export function expectRankOrder(candidates: readonly Candidate[]): void {
  const keys = candidates.map(rankKey);
  expect(keys).toEqual([...keys].sort(compareKeys));
}

/** Thang bốn bậc đúng thứ tự vận hành; bậc 3 phải nêu lý do vì 160–300 km > 15 km. */
export function expectLadder(kind: 'preview' | 'detail', rungs: CaseDetail['ladderPreview']): void {
  expect(
    rungs.map((rung) => rung.moveType),
    kind,
  ).toEqual([...LADDER_ORDER]);
  const crossProperty = rungs[2];
  expect(crossProperty?.feasible, `${kind}: bậc 3 không khả dụng`).toBe(false);
  expect(crossProperty?.note, `${kind}: bậc 3 phải kèm lý do`).toEqual(expect.any(String));
  expect(rungs[3]?.feasible, `${kind}: bậc 4 luôn là phương án cuối`).toBe(true);
}
