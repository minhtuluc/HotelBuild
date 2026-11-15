'use client';
/**
 * Mặt cắt năm khoang (HB-323, UX-02): mỗi khoang là một toa vẽ đúng số chỗ ngủ (seed `bedCount`); Dorm ghi
 * bán theo giường. Không vẽ cách kê giường (kế hoạch §8.2). Nhóm nút chọn một (`radiogroup`): Tab vào nhóm,
 * mũi tên chuyển khoang; chọn khoang thì hàng hạng tương ứng nổi viền (`data-sync="class"`) và dòng tóm tắt
 * `aria-live` đổi theo. Không JS thì vẫn thấy năm toa và số chỗ ngủ.
 */
import { useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { markSync } from './sync-highlight';

export interface DiagramCabin {
  readonly code: string;
  readonly sleeps: number;
  /** Tóm tắt đọc lên khi chọn (đã dịch ở máy chủ). */
  readonly summary: string;
}

/** Vị trí kế tiếp theo phím; `null` nếu phím không đổi vị trí. Thuần, để test. */
export function nextIndex(key: string, index: number, length: number): number | null {
  if (key === 'ArrowRight' || key === 'ArrowDown') return (index + 1) % length;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (index - 1 + length) % length;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  return null;
}

const DOT = 9;
const GAP = 5;

function Berths({ sleeps }: { sleeps: number }): ReactElement {
  const perRow = sleeps > 3 ? Math.ceil(sleeps / 2) : sleeps;
  const rows = Math.ceil(sleeps / perRow);
  const width = 64;
  const height = 40;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="ph-cabin-car-art" aria-hidden="true">
      <rect
        x="1"
        y="1"
        width={width - 2}
        height={height - 2}
        rx="4"
        className="ph-cabin-car-body"
      />
      {Array.from({ length: sleeps }, (_, index) => {
        const row = Math.floor(index / perRow);
        const col = index % perRow;
        const rowWidth = perRow * DOT + (perRow - 1) * GAP;
        const x = (width - rowWidth) / 2 + col * (DOT + GAP);
        const y = (height - (rows * DOT + (rows - 1) * GAP)) / 2 + row * (DOT + GAP);
        return (
          <rect
            key={index}
            x={x}
            y={y}
            width={DOT}
            height={DOT}
            rx="2"
            className="ph-cabin-berth"
          />
        );
      })}
    </svg>
  );
}

export function CabinDiagram({
  cabins,
  label,
  hint,
}: {
  cabins: readonly DiagramCabin[];
  label: string;
  hint: string;
}): ReactElement {
  const [selected, setSelected] = useState<number | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const choose = (index: number): void => {
    setSelected(index);
    markSync('class', cabins[index]?.code ?? null);
  };
  const keys = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const next = nextIndex(event.key, index, cabins.length);
    if (next === null) return;
    event.preventDefault();
    choose(next);
    buttons.current[next]?.focus();
  };
  const focusable = selected ?? 0;
  const current = selected === null ? undefined : cabins[selected];
  return (
    <div className="ph-cabin-diagram" data-testid="cabin-diagram">
      <div role="radiogroup" aria-label={label} className="ph-cabin-train">
        {cabins.map((cabin, index) => (
          <button
            key={cabin.code}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected === index}
            aria-label={cabin.summary}
            tabIndex={index === focusable ? 0 : -1}
            className="ph-cabin-car"
            data-testid={`cabin-car-${cabin.code}`}
            onClick={() => choose(index)}
            onKeyDown={(event) => keys(event, index)}
          >
            <Berths sleeps={cabin.sleeps} />
            <span className="ph-cabin-car-code" aria-hidden="true">
              {cabin.code}
            </span>
          </button>
        ))}
      </div>
      <p className="ph-cabin-summary" aria-live="polite" data-testid="cabin-summary">
        {current?.summary ?? hint}
      </p>
    </div>
  );
}
