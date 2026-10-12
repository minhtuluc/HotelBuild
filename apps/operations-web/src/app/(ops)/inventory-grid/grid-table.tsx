'use client';

/**
 * Lưới tồn phòng dạng bảng ARIA (`role="grid"`): mỗi ô là một `gridcell` đi được bằng bàn phím
 * (←/→/↑/↓, Home/End) và hiện **ký hiệu chữ kèm màu** để thông tin không chỉ truyền bằng màu (UI-06).
 */
import { useRef, type KeyboardEvent, type ReactElement } from 'react';
import type { InventoryGrid } from '@pinehill/contracts';
import { gridStatus } from '@pinehill/ui-web';
import {
  cellKey,
  cellStatus,
  nextCellIndex,
  publishedAvailability,
  type CellPosition,
  type CellStatus,
  type GridKey,
} from '../../../lib/inventory-grid';
import { t } from '../../../lib/i18n';

type Cell = InventoryGrid['cells'][number];

export interface GridRow {
  roomTypeId: string;
  code: string;
  cells: readonly Cell[];
}

/** Ký hiệu + màu lấy từ token dùng chung; thiếu một khoá là lỗi biên dịch. */
const STATUS_TOKENS: Readonly<Record<CellStatus, keyof typeof gridStatus>> = {
  available: 'available',
  held: 'held',
  blocked: 'blocked',
  oversold: 'oversold',
};

const STATUS_LABELS: Readonly<Record<CellStatus, () => string>> = {
  available: () => t('grid.status.available'),
  held: () => t('grid.status.held'),
  blocked: () => t('grid.status.blocked'),
  oversold: () => t('grid.status.oversold'),
};

const GRID_KEYS: readonly GridKey[] = [
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
];

function isGridKey(value: string): value is GridKey {
  return GRID_KEYS.some((key) => key === value);
}

export function cellText(cell: Cell): string {
  return `${gridStatus[STATUS_TOKENS[cellStatus(cell)]].symbol} ${cell.published ?? publishedAvailability(cell)}`;
}

export function GridLegend(): ReactElement {
  const statuses: readonly CellStatus[] = ['available', 'held', 'blocked', 'oversold'];
  return (
    <ul
      data-testid="grid-legend"
      style={{
        display: 'flex',
        gap: 'var(--space-s4, 16px)',
        listStyle: 'none',
        padding: 0,
        margin: 0,
      }}
    >
      {statuses.map((status) => (
        <li key={status}>
          <span
            aria-hidden="true"
            style={{
              background: gridStatus[STATUS_TOKENS[status]].background,
              color: gridStatus[STATUS_TOKENS[status]].text,
              padding: '0 var(--space-s1, 4px)',
              marginInlineEnd: 4,
            }}
          >
            {gridStatus[STATUS_TOKENS[status]].symbol}
          </span>
          {STATUS_LABELS[status]()}
        </li>
      ))}
    </ul>
  );
}

export function GridTable({
  dates,
  rows,
  focus,
  onFocusChange,
}: {
  dates: readonly string[];
  rows: readonly GridRow[];
  focus: CellPosition;
  onFocusChange: (position: CellPosition) => void;
}): ReactElement {
  const tableRef = useRef<HTMLTableElement>(null);

  const move = (key: GridKey): void => {
    const next = nextCellIndex(focus, key, rows.length, dates.length);
    onFocusChange(next);
    const target = tableRef.current?.querySelector(`[data-cell="${cellKey(next)}"]`);
    if (target instanceof HTMLElement) target.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>): void => {
    if (!isGridKey(event.key)) return;
    event.preventDefault();
    move(event.key);
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        ref={tableRef}
        role="grid"
        data-testid="inventory-grid"
        aria-label={t('grid.tableLabel')}
        onKeyDown={onKeyDown}
        style={{ borderCollapse: 'collapse' }}
      >
        <thead>
          <tr role="row">
            <th role="columnheader" scope="col" style={{ textAlign: 'start' }}>
              {t('grid.col.roomType')}
            </th>
            {dates.map((date) => (
              <th key={date} role="columnheader" scope="col" style={{ padding: '0 4px' }}>
                {date.slice(8)}/{date.slice(5, 7)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={row.roomTypeId} role="row">
              <th role="rowheader" scope="row" style={{ textAlign: 'start' }}>
                {row.code}
              </th>
              {row.cells.map((cell, colIndex) => {
                const status = cellStatus(cell);
                const token = gridStatus[STATUS_TOKENS[status]];
                const available = publishedAvailability(cell);
                const focused = focus.row === rowIndex && focus.col === colIndex;
                return (
                  <td
                    key={cell.date}
                    role="gridcell"
                    data-cell={cellKey({ row: rowIndex, col: colIndex })}
                    data-status={status}
                    tabIndex={focused ? 0 : -1}
                    aria-label={`${row.code} ${cell.date}: ${t('grid.cellLabel', {
                      available,
                      supply: cell.supply,
                      demand: cell.demand,
                    })}`}
                    style={{ background: token.background, color: token.text, padding: '0 4px' }}
                  >
                    {token.symbol} {available}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
