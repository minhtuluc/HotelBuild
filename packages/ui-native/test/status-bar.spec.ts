import { describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({ StatusBar: { setBarStyle: vi.fn() } }));
import { applyDarkStatusBar, applyStatusBarStyle, STATUS_BAR_REAPPLY_MS } from '../src/status-bar';

// HB-267: máy thật (ColorOS, chế độ tối) — giờ/pin trên thanh trạng thái màu trắng trên nền sáng của app vì
// edge-to-edge đặt màu chữ theo chế độ của **máy** và ghi đè lần đặt lúc mount; đặt lại sau một nhịp thì giữ.
describe('chữ thanh trạng thái tối cho giao diện luôn sáng (HB-267)', () => {
  it('đặt chữ tối ngay và đặt lại sau một nhịp', () => {
    const bar = { setBarStyle: vi.fn() };
    const timers: Array<{ run: () => void; ms: number }> = [];
    applyDarkStatusBar(bar, (run, ms) => {
      timers.push({ run, ms });
      return () => undefined;
    });
    expect(bar.setBarStyle).toHaveBeenCalledWith('dark-content', false);
    expect(timers.map((timer) => timer.ms)).toEqual([STATUS_BAR_REAPPLY_MS]);
    timers[0]?.run();
    expect(bar.setBarStyle).toHaveBeenCalledTimes(2);
  });

  it('huỷ được nhịp đặt lại khi màn gốc tháo', () => {
    const cancel = vi.fn();
    const stop = applyDarkStatusBar({ setBarStyle: vi.fn() }, () => cancel);
    stop();
    expect(cancel).toHaveBeenCalledOnce();
  });
});

// HB-273: header bảng ga đen của app khách cần chữ trạng thái sáng; cùng cơ chế đặt lại sau một nhịp.
describe('chọn được kiểu chữ thanh trạng thái (HB-273)', () => {
  it('đặt chữ sáng ngay và đặt lại sau một nhịp', () => {
    const bar = { setBarStyle: vi.fn() };
    const runs: Array<() => void> = [];
    applyStatusBarStyle(bar, 'light-content', (run) => {
      runs.push(run);
      return () => undefined;
    });
    runs[0]?.();
    expect(bar.setBarStyle.mock.calls).toEqual([
      ['light-content', false],
      ['light-content', false],
    ]);
  });
});
