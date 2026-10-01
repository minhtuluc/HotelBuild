/** Cổng kiểm tra sống của một phụ thuộc; triển khai thật có thể được mock trong test. */
export const HEALTH_PROBES = Symbol('HEALTH_PROBES');

export interface HealthProbe {
  readonly name: string;
  check(): Promise<boolean>;
}
