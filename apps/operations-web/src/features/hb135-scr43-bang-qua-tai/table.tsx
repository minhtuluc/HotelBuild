'use client';
import { useState, type CSSProperties, type ReactElement } from 'react';
import { color, fontFamily, formatDateTimeVn, radius, space, typography } from '@pinehill/ui-web';
import type { OverbookingCaseSummary } from '@pinehill/contracts';
import type { Rows } from './controller';
import { text } from './messages';
import { resolveIssues, type FieldIssue } from './model';
import { ConfirmDialog, TextInput } from './parts';

export const STATUS_TEXT = {
  OPEN: 'stOpen',
  PROPOSED: 'stProposed',
  RESOLVED: 'stResolved',
  ESCALATED: 'stEscalated',
} as const;

const STATUS_BADGE_STYLES: Readonly<Record<OverbookingCaseSummary['status'], CSSProperties>> = {
  OPEN: { background: '#F9EEDB', color: '#6D3908', border: `1px solid ${color.border}` },
  PROPOSED: { background: '#E4EAF6', color: '#24346E', border: `1px solid ${color.border}` },
  RESOLVED: { background: '#E7F3EE', color: '#0D5A4A', border: `1px solid ${color.border}` },
  ESCALATED: { background: '#FADDDD', color: '#991B1B', border: `1px solid ${color.danger}` },
};

const BADGE_BASE: CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: radius.sm,
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const when = (value: string | null): string =>
  value === null ? text('none') : formatDateTimeVn(value);

function resolvedBy(row: OverbookingCaseSummary): string {
  if (row.resolvedAt === null) return text('none');
  const who =
    row.resolutionSource === 'SYSTEM'
      ? text('bySystem')
      : text('byUser', { id: row.resolvedBy ?? text('none') });
  return `${formatDateTimeVn(row.resolvedAt)} ${who}`;
}

function Row({
  row,
  canResolve,
  busy,
  onAsk,
}: {
  row: OverbookingCaseSummary;
  canResolve: boolean;
  busy: boolean;
  onAsk: (row: OverbookingCaseSummary) => void;
}): ReactElement {
  return (
    <tr data-testid={`hb135-row-${row.id}`}>
      <th scope="row" style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
        {row.date}
      </th>
      <td>{row.roomTypeCode ?? row.roomTypeId}</td>
      <td>{row.shortageCount}</td>
      <td>
        <span style={{ ...BADGE_BASE, ...STATUS_BADGE_STYLES[row.status] }}>
          {text(STATUS_TEXT[row.status])}
        </span>
      </td>
      <td>
        <span>{when(row.resolveDeadline)}</span>{' '}
        <strong
          style={{
            ...BADGE_BASE,
            background: row.overdue ? '#FADDDD' : '#E7F3EE',
            color: row.overdue ? '#991B1B' : color.success,
            border: `1px solid ${row.overdue ? color.danger : color.border}`,
          }}
        >
          {row.overdue ? text('overdue') : text('inTime')}
        </strong>
      </td>
      <td>{when(row.escalatedAt)}</td>
      <td>{resolvedBy(row)}</td>
      <td>{row.delayReason ?? text('none')}</td>
      <td>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.s2, alignItems: 'center' }}>
          <a
            href={`/overbooking/relocation?caseId=${encodeURIComponent(row.id)}`}
            className="ph-btn"
            style={{ whiteSpace: 'nowrap' }}
          >
            {text('open')}
          </a>
          {canResolve && row.status !== 'RESOLVED' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onAsk(row)}
              className="ph-btn-primary"
              style={{
                textTransform: 'none',
                letterSpacing: '0.02em',
                fontSize: 13,
                padding: '0 12px',
                whiteSpace: 'nowrap',
              }}
              data-testid={`hb135-resolve-${row.id}`}
            >
              {text('resolve')}
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function Table(props: {
  rows: readonly OverbookingCaseSummary[];
  canResolve: boolean;
  busy: boolean;
  onAsk: (row: OverbookingCaseSummary) => void;
}): ReactElement {
  return (
    <div
      role="region"
      aria-label={text('listLabel')}
      tabIndex={0}
      style={{
        overflowX: 'auto',
        maxWidth: '100%',
        border: `1px solid ${color.border}`,
        borderRadius: radius.sm,
      }}
    >
      <table data-testid="hb135-table" style={{ fontVariantNumeric: 'tabular-nums' }}>
        <thead>
          <tr>
            <th scope="col">{text('colDate')}</th>
            <th scope="col">{text('colType')}</th>
            <th scope="col">{text('colShortage')}</th>
            <th scope="col">{text('colStatus')}</th>
            <th scope="col">{text('colDeadline')}</th>
            <th scope="col">{text('colEscalated')}</th>
            <th scope="col">{text('colResolved')}</th>
            <th scope="col">{text('colDelay')}</th>
            <th scope="col">{text('colAction')}</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <Row
              key={row.id}
              row={row}
              canResolve={props.canResolve}
              busy={props.busy}
              onAsk={props.onAsk}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Hộp thoại đóng ca: bắt buộc ghi chú; bản nhập được giữ khi máy chủ từ chối. */
function ResolveDialog(props: {
  target: OverbookingCaseSummary | null;
  serverIssues: readonly FieldIssue[];
  onCancel: () => void;
  onConfirm: (note: string) => void;
}): ReactElement {
  const [note, setNote] = useState('');
  const [local, setLocal] = useState<readonly FieldIssue[]>([]);
  return (
    <ConfirmDialog
      id="hb135-dialog-resolve"
      open={props.target !== null}
      title={text('resolveTitle')}
      confirmLabel={text('confirmResolve')}
      cancelLabel={text('cancel')}
      onCancel={props.onCancel}
      onConfirm={() => {
        const found = resolveIssues(note);
        setLocal(found);
        if (found.length === 0) props.onConfirm(note);
      }}
    >
      <p style={{ margin: 0, fontSize: 14, color: color.textMuted }}>{text('resolveNote')}</p>
      <TextInput
        name="resolutionNote"
        label={text('resolutionNote')}
        value={note}
        issues={[...local, ...props.serverIssues]}
        onChange={(value) => {
          setLocal([]);
          setNote(value);
        }}
      />
    </ConfirmDialog>
  );
}

/** Trống chỉ được báo "không có ca" khi `confirmedEmpty`; ngược lại là chưa xác định (AC3). */
export function CaseTable(props: {
  list: Rows | null;
  confirmedEmpty: boolean;
  canResolve: boolean;
  busy: boolean;
  serverIssues: readonly FieldIssue[];
  onMore: () => void;
  onResolve: (caseId: string, note: string) => void;
}): ReactElement {
  const [target, setTarget] = useState<OverbookingCaseSummary | null>(null);
  const rows = props.list?.rows ?? [];
  return (
    <section
      className="ph-card"
      style={{ display: 'grid', gap: space.s3, minWidth: 0 }}
      aria-labelledby="hb135-list-title"
      data-testid="hb135-list"
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: space.s2,
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}
      >
        <h2
          id="hb135-list-title"
          style={{ margin: 0, fontFamily: fontFamily.sans, fontSize: typography.h2.web }}
        >
          {text('listLabel')}
        </h2>
        {props.list === null ? null : (
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: color.textMuted,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {text('total', { total: props.list.total })}
          </p>
        )}
      </div>
      {rows.length === 0 ? (
        props.list === null ? null : (
          <p data-testid="hb135-empty" style={{ margin: 0, color: color.textMuted }}>
            {props.confirmedEmpty ? text('confirmedEmpty') : text('notConfirmedEmpty')}
          </p>
        )
      ) : (
        <Table rows={rows} canResolve={props.canResolve} busy={props.busy} onAsk={setTarget} />
      )}
      {props.list?.nextCursor === null || props.list === null ? null : (
        <button
          type="button"
          onClick={props.onMore}
          className="ph-btn"
          style={{ justifySelf: 'start' }}
        >
          {text('loadMore')}
        </button>
      )}
      <ResolveDialog
        target={target}
        serverIssues={props.serverIssues}
        onCancel={() => setTarget(null)}
        onConfirm={(note) => {
          const id = target?.id;
          setTarget(null);
          if (id !== undefined) props.onResolve(id, note);
        }}
      />
    </section>
  );
}
