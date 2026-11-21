/** HB-278 — nút của app vận hành theo đúng vai nút của operations web (DESIGN.md §Buttons). */
import { describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({}));
import { color } from '@pinehill/ui-native';
import { actionButtonStyle } from '../src/arrivals/controls-style';

describe('HB-278 nút vận hành', () => {
  it('chính = mực in; phụ = viền; nguy hiểm = viền đỏ', () => {
    expect(actionButtonStyle('primary', false).container.backgroundColor).toBe(color.primary);
    expect(actionButtonStyle('plain', false).container.borderColor).toBe(color.borderStrong);
    expect(actionButtonStyle('danger', false).label.color).toBe(color.danger);
  });

  it('không bấm được thì đổi nền, không làm mờ cả nút', () => {
    const style = actionButtonStyle('primary', true);
    expect(style.container.backgroundColor).toBe(color.surfaceMuted);
    expect(style.container.opacity).toBeUndefined();
  });

  it('vùng chạm ≥ 48 dp, nhấn thì xuống 1 dp', () => {
    expect(actionButtonStyle('plain', false).container.minHeight).toBeGreaterThanOrEqual(48);
    expect(actionButtonStyle('primary', false, true).container.transform).toEqual([
      { translateY: 1 },
    ]);
  });
});
