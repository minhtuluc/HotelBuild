'use client';
import { useState, type ReactElement } from 'react';
import { formatDateTimeVn } from '@pinehill/ui-web';
import type { OverbookingCaseSummary } from '@pinehill/contracts';
import type { Rows } from './controller';
import { text } from './messages';
import { resolveIssues, type FieldIssue } from './model';
import { ConfirmDialog, TextInput, box } from './parts';

export const STATUS_TEXT = {
  OPEN: 'stOpen',
  PROPOSED: 'stProposed',
  RESOLVED: 'stResolved',
  ESCALATED: 'stEscalated',
} as const;

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
      <th scope="row">{row.date}</th>
      <td>{row.roomTypeCode ?? row.roomTypeId}</td>
      <td>{row.shortageCount}</td>
      <td>{text(STATUS_TEXT[row.status])}</td>
      <td>
        {when(row.resolveDeadline)} ·{' '}
        <strong>{row.overdue ? text('overdue') : text('inTime')}</strong>
      </td>
      <td>{when(row.escalatedAt)}</td>
      <td>{resolvedBy(row)}</td>
      <td>{row.delayReason ?? text('none')}</td>
      <td>
        <a href={`/overbooking/relocation?caseId=${encodeURIComponent(row.id)}`}>{text('open')}</a>
        {canResolve && row.status !== 'RESOLVED' ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAsk(row)}
            style={{ minHeight: 44, marginLeft: 8 }}
            data-testid={`hb135-resolve-${row.id}`}
          >
            {text('resolve')}
          </button>
        ) : null}
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
      style={{ overflowX: 'auto', maxWidth: '100%' }}
    >
      <table data-testid="hb135-table">
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
      <p>{text('resolveNote')}</p>
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
    <section style={box} aria-labelledby="hb135-list-title" data-testid="hb135-list">
      <h2 id="hb135-list-title">{text('listLabel')}</h2>
      {props.list === null ? null : <p>{text('total', { total: props.list.total })}</p>}
      {rows.length === 0 ? (
        props.list === null ? null : (
          <p data-testid="hb135-empty">
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
          style={{ minHeight: 44, justifySelf: 'start' }}
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
