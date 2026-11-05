/**
 * Geography for the relocation ladder (BR-OVER-05 bậc 3, BR-OVER-07).
 *
 * Standard step 3 needs **both** the same city and a road distance inside the radius (15 km).
 * Everything else — different city, farther away, unknown distance — is excluded from the ladder
 * and may only be proposed through the explicit BR-OVER-07 route, which is not a ladder step and
 * requires written guest consent plus `MANAGER`+ approval. The engine receives the configuration;
 * it never reads a map service or a clock.
 */
import { err, ok } from '../../shared/result.js';
import type { Result } from '../../shared/result.js';
import type { StaffApproverRole } from '../merge/policy.js';

/** BR-OVER-05: standard cross-property relocation radius, inclusive. */
export const DEFAULT_STEP3_MAX_DISTANCE_KM = 15;

export interface GeoProperty {
  readonly propertyId: string;
  readonly city: string;
}

export interface PropertyDistance {
  readonly fromPropertyId: string;
  readonly toPropertyId: string;
  /** Road distance in kilometres; finite and non-negative. Direction is normalized away. */
  readonly roadDistanceKm: number;
}

export interface RelocationGeography {
  readonly properties: readonly GeoProperty[];
  readonly distances: readonly PropertyDistance[];
  /** Override for the standard step-3 radius; defaults to {@link DEFAULT_STEP3_MAX_DISTANCE_KM}. */
  readonly maxStep3DistanceKm?: number;
}

export interface GeographyFailure {
  readonly code: 'E_OVER_INVALID_INPUT';
  readonly message: string;
}

export type Step3EligibilityReason =
  'SAME_CITY_WITHIN_RADIUS' | 'DIFFERENT_CITY' | 'OUTSIDE_RADIUS' | 'DISTANCE_UNKNOWN';

export interface StandardStep3Eligibility {
  readonly fromPropertyId: string;
  readonly toPropertyId: string;
  readonly city: string;
  readonly roadDistanceKm: number | null;
  readonly maxStep3DistanceKm: number;
  readonly eligible: boolean;
  readonly reason: Step3EligibilityReason;
}

/** Validated, immutable view of {@link RelocationGeography}. */
export interface GeographyIndex {
  readonly cities: ReadonlyMap<string, string>;
  readonly distancesKm: ReadonlyMap<string, number>;
  readonly maxStep3DistanceKm: number;
  readonly spanKm: { readonly min: number; readonly max: number } | null;
}

function invalid(message: string): Result<never, GeographyFailure> {
  return err({ code: 'E_OVER_INVALID_INPUT', message });
}

function pairKey(left: string, right: string): string {
  return left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`;
}

function nonEmptyId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function indexProperties(
  properties: readonly GeoProperty[],
): Result<Map<string, string>, GeographyFailure> {
  const cities = new Map<string, string>();
  for (const property of properties) {
    if (!nonEmptyId(property.propertyId) || !nonEmptyId(property.city))
      return invalid('Expected non-empty property ID and city');
    if (cities.has(property.propertyId))
      return invalid(`Duplicate property ${property.propertyId}`);
    cities.set(property.propertyId, property.city.trim());
  }
  return ok(cities);
}

interface DistanceIndex {
  readonly distancesKm: ReadonlyMap<string, number>;
  readonly spanKm: GeographyIndex['spanKm'];
}

function distanceProblem(
  distance: PropertyDistance,
  cities: ReadonlyMap<string, string>,
): string | null {
  if (!nonEmptyId(distance.fromPropertyId) || !nonEmptyId(distance.toPropertyId))
    return 'Expected non-empty distance endpoint properties';
  if (distance.fromPropertyId === distance.toPropertyId)
    return 'Relocation distance endpoints must differ';
  if (!Number.isFinite(distance.roadDistanceKm) || distance.roadDistanceKm < 0)
    return 'Expected a finite non-negative road distance';
  if (!cities.has(distance.fromPropertyId) || !cities.has(distance.toPropertyId))
    return `Distance references unknown property ${distance.fromPropertyId}`;
  return null;
}

function indexDistances(
  distances: readonly PropertyDistance[],
  cities: ReadonlyMap<string, string>,
): Result<DistanceIndex, GeographyFailure> {
  const distancesKm = new Map<string, number>();
  let min: number | null = null;
  let max: number | null = null;
  for (const distance of distances) {
    const problem = distanceProblem(distance, cities);
    if (problem !== null) return invalid(problem);
    const key = pairKey(distance.fromPropertyId, distance.toPropertyId);
    if (distancesKm.has(key))
      return invalid(`Duplicate distance for ${distance.fromPropertyId}/${distance.toPropertyId}`);
    distancesKm.set(key, distance.roadDistanceKm);
    min = min === null ? distance.roadDistanceKm : Math.min(min, distance.roadDistanceKm);
    max = max === null ? distance.roadDistanceKm : Math.max(max, distance.roadDistanceKm);
  }
  return ok({ distancesKm, spanKm: min === null || max === null ? null : { min, max } });
}

/** Validates and indexes the configuration; also rejects contradictory duplicate distances. */
export function indexGeography(
  geography: RelocationGeography,
): Result<GeographyIndex, GeographyFailure> {
  if (geography.properties.length === 0) return invalid('Expected at least one property');

  const maxStep3DistanceKm = geography.maxStep3DistanceKm ?? DEFAULT_STEP3_MAX_DISTANCE_KM;
  if (!Number.isFinite(maxStep3DistanceKm) || maxStep3DistanceKm <= 0)
    return invalid('Step-3 radius must be a finite positive number');

  const properties = indexProperties(geography.properties);
  if (!properties.ok) return properties;
  const distances = indexDistances(geography.distances, properties.value);
  if (!distances.ok) return distances;

  return ok({
    cities: properties.value,
    distancesKm: distances.value.distancesKm,
    maxStep3DistanceKm,
    spanKm: distances.value.spanKm,
  });
}

function eligibilityReason(
  sameCity: boolean,
  roadDistanceKm: number | null,
  withinRadius: boolean,
): Step3EligibilityReason {
  if (!sameCity) return 'DIFFERENT_CITY';
  if (roadDistanceKm === null) return 'DISTANCE_UNKNOWN';
  return withinRadius ? 'SAME_CITY_WITHIN_RADIUS' : 'OUTSIDE_RADIUS';
}

/**
 * Standard step-3 eligibility for `from → to`. `eligible` is true only when the properties share a
 * city and the configured road distance is at most the radius. A missing distance is treated as
 * unusable rather than assumed to be close.
 */
export function step3Eligibility(
  index: GeographyIndex,
  fromPropertyId: string,
  toPropertyId: string,
): Result<StandardStep3Eligibility, GeographyFailure> {
  if (!nonEmptyId(fromPropertyId) || !nonEmptyId(toPropertyId))
    return invalid('Expected non-empty property IDs');
  if (fromPropertyId === toPropertyId)
    return invalid('Relocation source and target property must differ');

  const city = index.cities.get(toPropertyId);
  const originCity = index.cities.get(fromPropertyId);
  if (city === undefined || originCity === undefined)
    return invalid('Relocation property is not part of the configured geography');

  const roadDistanceKm = index.distancesKm.get(pairKey(fromPropertyId, toPropertyId)) ?? null;
  const sameCity = originCity === city;
  const withinRadius = roadDistanceKm !== null && roadDistanceKm <= index.maxStep3DistanceKm;

  return ok({
    fromPropertyId,
    toPropertyId,
    city,
    roadDistanceKm,
    maxStep3DistanceKm: index.maxStep3DistanceKm,
    eligible: sameCity && withinRadius,
    reason: eligibilityReason(sameCity, roadDistanceKm, withinRadius),
  });
}

/** Convenience wrapper for callers that only hold the raw configuration. */
export function checkStandardStep3(
  geography: RelocationGeography,
  fromPropertyId: string,
  toPropertyId: string,
): Result<StandardStep3Eligibility, GeographyFailure> {
  const index = indexGeography(geography);
  return index.ok ? step3Eligibility(index.value, fromPropertyId, toPropertyId) : index;
}

/**
 * Why the standard ladder has no usable step 3. Includes the configured span (the Đà Lạt–Vũng Tàu–
 * Phan Thiết fixture reports `160–300 km`) so the manager sees the real reason rather than a guess.
 */
export function standardStep3GapNote(index: GeographyIndex): string {
  const radius = `${index.maxStep3DistanceKm}`;
  if (index.spanKm === null)
    return `Bậc 3 không khả dụng: chưa có khoảng cách cơ sở, cần cùng thành phố và ≤ ${radius} km`;
  const { min, max } = index.spanKm;
  const span = min === max ? `${min} km` : `${min}–${max} km`;
  return `Bậc 3 không khả dụng: các cơ sở cách nhau ${span}, ngoài bán kính ${radius} km hoặc khác thành phố`;
}

/** BR-OVER-07: written guest consent, not a phone note and not a system default. */
export interface CrossCityConsentInput {
  readonly granted: boolean;
  readonly channel: 'WRITTEN';
  readonly evidenceRef?: string;
}

export interface CrossCityApprovalInput {
  readonly role: StaffApproverRole;
  readonly approvedByActorId: string;
}

export interface CrossCityExceptionRequest {
  readonly bookingId: string;
  readonly roomId: string;
  readonly fromPropertyId: string;
  readonly toPropertyId: string;
  readonly geography: RelocationGeography;
  readonly consent?: CrossCityConsentInput;
  readonly approval?: CrossCityApprovalInput;
  /** Actual support decided by `MANAGER`+; the exception route has no 500.000 cap. */
  readonly transportSupportVnd?: number;
}

export type CrossCityExceptionFailureCode =
  'E_OVER_INVALID_INPUT' | 'E_OVER_CROSS_CITY_NO_CONSENT' | 'E_OVER_APPROVAL_REQUIRED';

export interface CrossCityExceptionFailure {
  readonly code: CrossCityExceptionFailureCode;
  readonly message: string;
}

/**
 * BR-OVER-07 exception proposal. It is deliberately **not** a ladder step
 * (`standardLadderStep = null`) and it is never executable by itself: consent and approval are
 * recorded, the actual support is manager-decided, and execution stays in its own workflow.
 */
export interface CrossCityExceptionDecision {
  readonly kind: 'BR_OVER_07_EXCEPTION';
  readonly bookingId: string;
  readonly roomId: string;
  readonly fromPropertyId: string;
  readonly toPropertyId: string;
  readonly countsAsStandardLadderStep: false;
  readonly standardLadderStep: null;
  readonly writtenConsentRequired: true;
  readonly writtenConsentSatisfied: true;
  readonly managerApprovalRequired: true;
  readonly managerApprovalSatisfied: true;
  readonly transportSupportVnd: number;
  readonly transportSupportCapVnd: null;
  readonly transportSupportDecidedByManager: true;
  readonly priceLocked: true;
  readonly inventoryHeld: false;
  readonly assignmentChanged: false;
  readonly executable: false;
}

/** BR-OVER-07 requires written consent with evidence; a phone note or default is not enough. */
function writtenConsentRecorded(consent: CrossCityConsentInput | undefined): boolean {
  return (
    consent !== undefined &&
    consent.granted === true &&
    consent.channel === 'WRITTEN' &&
    nonEmptyId(consent.evidenceRef)
  );
}

function managerApprovalRecorded(approval: CrossCityApprovalInput | undefined): boolean {
  return (
    approval !== undefined &&
    (approval.role === 'MANAGER' || approval.role === 'OWNER') &&
    nonEmptyId(approval.approvedByActorId)
  );
}

/** Proposes the explicit cross-city exception; it never turns into standard step 3. */
export function proposeCrossCityException(
  request: CrossCityExceptionRequest,
): Result<CrossCityExceptionDecision, CrossCityExceptionFailure> {
  const ids = [request.bookingId, request.roomId, request.fromPropertyId, request.toPropertyId];
  if (!ids.every(nonEmptyId)) return invalid('Expected non-empty booking, room and property IDs');

  const index = indexGeography(request.geography);
  if (!index.ok) return index;
  const eligibility = step3Eligibility(index.value, request.fromPropertyId, request.toPropertyId);
  if (!eligibility.ok) return eligibility;
  if (eligibility.value.eligible)
    return invalid(
      'Target property is inside the standard step-3 radius; use SAME_TYPE_CROSS_PROPERTY instead of BR-OVER-07',
    );

  if (!writtenConsentRecorded(request.consent))
    return err({
      code: 'E_OVER_CROSS_CITY_NO_CONSENT',
      message: 'BR-OVER-07 requires written guest consent with an evidence reference',
    });

  if (!managerApprovalRecorded(request.approval))
    return err({
      code: 'E_OVER_APPROVAL_REQUIRED',
      message: 'BR-OVER-07 cross-city relocation requires MANAGER or OWNER approval',
    });

  const transportSupportVnd = request.transportSupportVnd ?? 0;
  if (!Number.isSafeInteger(transportSupportVnd) || transportSupportVnd < 0)
    return invalid('Transport support must be a non-negative safe integer in VND');

  return ok({
    kind: 'BR_OVER_07_EXCEPTION',
    bookingId: request.bookingId,
    roomId: request.roomId,
    fromPropertyId: request.fromPropertyId,
    toPropertyId: request.toPropertyId,
    countsAsStandardLadderStep: false,
    standardLadderStep: null,
    writtenConsentRequired: true,
    writtenConsentSatisfied: true,
    managerApprovalRequired: true,
    managerApprovalSatisfied: true,
    transportSupportVnd,
    transportSupportCapVnd: null,
    transportSupportDecidedByManager: true,
    priceLocked: true,
    inventoryHeld: false,
    assignmentChanged: false,
    executable: false,
  });
}
