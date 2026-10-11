/** Internal reader; callers receive immutable values, never HTTP authorization decisions. */
export const RUNTIME_SETTINGS = Symbol('RUNTIME_SETTINGS');
export interface RuntimeSettings {
  get(key: string): Promise<string>;
  invalidate(key: string): void;
}
