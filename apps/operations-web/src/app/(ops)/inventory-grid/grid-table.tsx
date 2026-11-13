'use client';

/**
 * Lưới tồn phòng dạng bảng ARIA (`role="grid"`): mỗi ô là một `gridcell` đi được bằng bàn phím
 * (←/→/↑/↓, Home/End) và hiện **ký hiệu chữ kèm màu** để thông tin không chỉ truyền bằng màu (UI-06).
 */
import { useRef, type CSSProperties, type KeyboardEvent, type ReactElement } from 'react';
import type { InventoryGrid } from '@pinehill/contracts';
import { color, gridStatus, radius, space, type GridStatusKey } from '@pinehill/ui-web';
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
import { gridText } from './messages-session';

type Cell = InventoryGrid['cells'][number];

export interface GridRow {
  roomTypeId: string;
  code: string;
  cells: readonly Cell[];
}

/** Ký hiệu + màu lấy từ token dùng chung; thiếu một khoá là lỗi biên dịch. */
const STATUS_TOKENS: Readonly<Record<CellStatus, GridStatusKey>> = {
  available: 'available',
  held: 'held',
  blocked: 'blocked',
  oversold: 'oversold',
};

const ALL_LEGEND_STATUSES: readonly GridStatusKey[] = [
  'available',
  'arriving',
  'inHouse',
  'departing',
  'held',
  'blocked',
  'dirty',
  'oversold',
  'otaClosed',
];

const LEGEND_LABELS: Readonly<Record<GridStatusKey, () => string>> = {
  available: () => t('grid.status.available'),
  arriving: () => gridText('statusArriving'),
  inHouse: () => gridText('statusInHouse'),
  departing: () => gridText('statusDeparting'),
  held: () => t('grid.status.held'),
  blocked: () => t('grid.status.blocked'),
  dirty: () => gridText('statusDirty'),
  oversold: () => t('grid.status.oversold'),
  otaClosed: () => gridText('statusOtaClosed'),
};

const GRID_KEYS: readonly GridKey[] = [
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
];

const STICKY_HEAD_STYLE: CSSProperties = {
  position: 'sticky',
  left: 0,
  zIndex: 2,
  background: 'var(--color-surface, #FBFAF7)',
  borderRight: `1px solid ${color.border}`,
  textAlign: 'start',
  whiteSpace: 'nowrap',
};

const STICKY_CELL_STYLE: CSSProperties = {
  position: 'sticky',
  left: 0,
  zIndex: 1,
  background: 'var(--color-surface, #FBFAF7)',
  borderRight: `1px solid ${color.border}`,
  textAlign: 'start',
  whiteSpace: 'nowrap',
  fontWeight: 500,
};

function isGridKey(value: string): value is GridKey {
  return GRID_KEYS.some((key) => key === value);
}

export function cellText(cell: Cell): string {
  return `${gridStatus[STATUS_TOKENS[cellStatus(cell)]].symbol} ${cell.published ?? publishedAvailability(cell)}`;
}

export function GridLegend(): ReactElement {
  return (
    <ul
      data-testid="grid-legend"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: `${space.s2}px ${space.s3}px`,
        listStyle: 'none',
        padding: `${space.s3}px ${space.s4}px`,
        margin: 0,
        background: color.surface,
        border: `1px solid ${color.border}`,
        borderRadius: radius.sm,
      }}
    >
      {ALL_LEGEND_STATUSES.map((status) => {
        const token = gridStatus[status];
        const border = token.dashedBorder
          ? `1px dashed ${token.dashedBorder}`
          : `1px solid ${color.border}`;
        return (
          <li
            key={status}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              color: color.text,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 22,
                height: 22,
                background: token.background,
                color: token.text,
                border,
                borderRadius: radius.sm,
                padding: '0 5px',
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {token.symbol}
            </span>
            <span>{LEGEND_LABELS[status]()}</span>
          </li>
        );
      })}
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
    <div
      style={{
        overflowX: 'auto',
        maxWidth: '100%',
        background: 'var(--color-surface, #FBFAF7)',
        border: `1px solid ${color.border}`,
        borderRadius: radius.sm,
      }}
    >
      <table
        ref={tableRef}
        role="grid"
        data-testid="inventory-grid"
        aria-label={t('grid.tableLabel')}
        onKeyDown={onKeyDown}
        style={{
          borderCollapse: 'collapse',
          width: '100%',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <thead>
          <tr role="row">
            <th role="columnheader" scope="col" style={STICKY_HEAD_STYLE}>
              {t('grid.col.roomType')}
            </th>
            {dates.map((date) => (
              <th
                key={date}
                role="columnheader"
                scope="col"
                style={{
                  padding: '10px 8px',
                  textAlign: 'center',
                  whiteSpace: 'nowrap',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {date.slice(8)}/{date.slice(5, 7)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={row.roomTypeId} role="row">
              <th role="rowheader" scope="row" style={STICKY_CELL_STYLE}>
                {row.code}
              </th>
              {row.cells.map((cell, colIndex) => {
                const status = cellStatus(cell);
                const token = gridStatus[STATUS_TOKENS[status]];
                const available = cell.published ?? publishedAvailability(cell);
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
                    style={{
                      background: token.background,
                      color: token.text,
                      padding: '10px 8px',
                      textAlign: 'center',
                      whiteSpace: 'nowrap',
                      fontVariantNumeric: 'tabular-nums',
                      fontWeight: 500,
                      borderRight: `1px solid ${color.border}`,
                      borderBottom: `1px solid ${color.border}`,
                    }}
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
