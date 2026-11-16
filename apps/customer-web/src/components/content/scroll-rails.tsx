'use client';
/**
 * Hai lề trang chủ trên màn rộng (HB-327), học từ thước độ cao bám cuộn của mẫu tham chiếu Villa Castagneto:
 * - trái: đường ray bảng ga, mỗi dải của mục lục là một ga dừng, đầu tàu trượt nội suy giữa hai ga;
 * - phải: cuống vé hồng, dải nào đã đi qua thì lỗ thẳng hàng với ga đó được bấm (chỉ trang trí).
 * CSS chỉ cho hiện khi khung rộng từ 1520 px; hẹp hơn thì ẩn hẳn và dải mục lục ngang (`PageToc`) làm việc này.
 * Ga là neo cùng trang nên không có JS vẫn nhảy được; JS chỉ đặt vị trí đầu tàu và lỗ bấm.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import type { TocItem } from './page-toc';

export interface RailPosition {
  /** Vị trí đầu tàu theo đơn vị ga: 0 là ga đầu, `n − 1` là ga cuối, số lẻ là đang giữa hai ga. */
  readonly pos: number;
  /** Vạch đọc đã chạm ga đầu chưa. Chưa thì đầu tàu đứng chờ ở ga đầu, chưa lỗ nào bị bấm. */
  readonly started: boolean;
}

/**
 * Nội suy vị trí đầu tàu từ đỉnh các dải (toạ độ khung nhìn, tăng dần) và vạch đọc. Đầu tàu tới ga `i` đúng lúc
 * đỉnh dải `i` chạm vạch đọc, rồi trượt dần tới ga `i + 1` trong khi đọc dải `i`. Thuần, để test.
 */
export function railPosition(tops: readonly number[], line: number): RailPosition {
  const first = tops[0];
  if (first === undefined || line < first) return { pos: 0, started: false };
  for (let i = 0; i < tops.length - 1; i += 1) {
    const here = tops[i];
    const next = tops[i + 1];
    if (here === undefined || next === undefined) break;
    if (line < next) {
      const span = next - here;
      return { pos: i + (span > 0 ? (line - here) / span : 0), started: true };
    }
  }
  return { pos: tops.length - 1, started: true };
}

/** Vạch đọc: một phần ba chiều cao màn hình, trùng với `PageToc` để hai cách chỉ đọc cùng một chỗ. */
const READ_LINE = 1 / 3;

const pad = (n: number): string => String(n).padStart(2, '0');

export function ScrollRails({
  items,
  label,
}: {
  items: readonly TocItem[];
  label: string;
}): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<RailPosition>({ pos: 0, started: false });
  const last = items.length - 1;

  useEffect(() => {
    const root = rootRef.current;
    // Không đo khi hai lề đang ẩn (màn hẹp): khỏi đọc layout mỗi lần cuộn trên điện thoại.
    const wide = window.matchMedia('(min-width: 1520px)');
    const targets = items.flatMap((item) => {
      const node = document.getElementById(item.id);
      return node === null ? [] : [node];
    });
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const tops = targets.map((node) => node.getBoundingClientRect().top);
      const next = railPosition(tops, window.innerHeight * READ_LINE);
      root?.style.setProperty('--rail-pos', String(last > 0 ? next.pos / last : 0));
      // Chỉ dựng lại khi đổi ga hoặc vừa khởi hành; vị trí lẻ đi qua biến CSS, không qua React.
      setState((prev) =>
        Math.floor(prev.pos) === Math.floor(next.pos) && prev.started === next.started
          ? prev
          : next,
      );
    };
    const schedule = (): void => {
      if (frame === 0 && wide.matches) frame = window.requestAnimationFrame(measure);
    };
    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    wide.addEventListener('change', schedule);
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      wide.removeEventListener('change', schedule);
    };
  }, [items, last]);

  const at = Math.floor(state.pos);
  const current = state.started ? items[at] : undefined;
  /** Ga và lỗ vé cùng một vị trí dọc rãnh, để lỗ thẳng hàng với ga. */
  const stopStyle = (index: number): CSSProperties => ({
    top: `${last > 0 ? (index / last) * 100 : 0}%`,
  });

  return (
    <div
      ref={rootRef}
      className="ph-rails"
      data-started={state.started ? 'true' : 'false'}
      data-testid="scroll-rails"
    >
      <nav className="ph-rail" aria-label={label}>
        <p className="ph-rail-readout" aria-hidden="true">
          <span className="ph-rail-count">
            {pad(state.started ? at + 1 : 0)}
            <small>/{pad(items.length)}</small>
          </span>
          <span className="ph-rail-now">{current?.label ?? '—'}</span>
        </p>
        <div className="ph-rail-track">
          <span className="ph-rail-train" aria-hidden="true" />
          <ol>
            {items.map((item, index) => (
              <li
                key={item.id}
                style={stopStyle(index)}
                data-passed={state.started && index <= at ? 'true' : 'false'}
              >
                <a
                  href={`#${item.id}`}
                  aria-current={state.started && index === at ? 'true' : undefined}
                >
                  <span className="ph-rail-dot" aria-hidden="true" />
                  {item.label}
                </a>
              </li>
            ))}
          </ol>
        </div>
      </nav>
      <div className="ph-stub" aria-hidden="true">
        <span className="ph-stub-paper" />
        <span className="ph-stub-brand">Pine Hill</span>
        <div className="ph-stub-track">
          {items.map((item, index) => (
            <span
              key={item.id}
              className="ph-stub-hole"
              style={stopStyle(index)}
              data-punched={state.started && index <= at ? 'true' : 'false'}
            />
          ))}
        </div>
        <span className="ph-stub-count">
          {pad(state.started ? at + 1 : 0)}/{pad(items.length)}
        </span>
      </div>
    </div>
  );
}
