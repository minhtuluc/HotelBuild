'use client';
import { useState, type ReactElement } from 'react';
import { formatDateTimeVn } from '@pinehill/ui-web';
import type { RefundRequest, UserMe } from '@pinehill/contracts';
import type { Rows } from './controller';
import { text } from './messages';
import {
  canAct,
  pinIssues,
  rejectIssues,
  visibleRows,
  type FieldIssue,
  type Filter,
} from './model';
import { ConfirmDialog, TextInput, box, remap } from './parts';

export const STATUS_TEXT = {
  PENDING: 'stPending',
  APPROVED: 'stApproved',
  REJECTED: 'stRejected',
  PAID: 'stPaid',
  CANCELLED: 'stCancelled',
} as const;

/** Chi hoàn là luồng tài chính riêng; duyệt không đồng nghĩa đã chi. Chỉ đọc cờ/mốc máy chủ trả. */
function payout(row: RefundRequest): string {
  if (row.paidAt !== null) return text('payoutDone', { time: formatDateTimeVn(row.paidAt) });
  if (row.awaitingTransferConfirmation === true) return text('payoutAwait');
  return text('payoutNotYet');
}

function RowView({
  row,
  allowed,
  busy,
  onAsk,
}: {
  row: RefundRequest;
  allowed: boolean;
  busy: boolean;
  onAsk: (row: RefundRequest, kind: 'approve' | 'reject') => void;
}): ReactElement {
  const net = row.netRefund === undefined ? text('none') : String(row.netRefund);
  return (
    <tr data-testid={`hb138-row-${row.id}`}>
      <th scope="row">{row.id}</th>
      <td>{row.bookingId}</td>
      <td>{row.isForceMajeure ? text('forceMajeure') : text('normalRefund')}</td>
      <td>{row.evidenceRefs.join(', ') || text('none')}</td>
      <td>
        {text('tier', {
          tier: row.appliedTierId,
          percent: row.refundPercent,
          hours: row.hoursBeforeCheckIn,
        })}
      </td>
      <td>
        {text('amounts', {
          requested: row.requestedAmount,
          approved: row.approvedAmount ?? text('none'),
          fee: row.refundFee,
          net,
        })}
      </td>
      <td data-testid={`hb138-status-${row.id}`}>{text(STATUS_TEXT[row.status])}</td>
      <td>{text('people', { by: row.requestedBy, approver: row.approvedBy ?? text('none') })}</td>
      <td>
        {payout(row)} ·{' '}
        <a href={`/bookings/${encodeURIComponent(row.bookingId)}/refunds`}>{text('payoutLink')}</a>
      </td>
      <td>
        {allowed ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAsk(row, 'approve')}
              style={{ minHeight: 44 }}
              data-testid={`hb138-approve-${row.id}`}
            >
              {text('approve')}
            </button>{' '}
            <button
              type="button"
              disabled={busy}
              onClick={() => onAsk(row, 'reject')}
              style={{ minHeight: 44 }}
              data-testid={`hb138-reject-${row.id}`}
            >
              {text('reject')}
            </button>
          </>
        ) : null}
      </td>
    </tr>
  );
}

function Table(props: {
  rows: readonly RefundRequest[];
  actor: { role: UserMe['role']; userId: string };
  busy: boolean;
  onAsk: (row: RefundRequest, kind: 'approve' | 'reject') => void;
}): ReactElement {
  return (
    <div
      role="region"
      aria-label={text('listLabel')}
      tabIndex={0}
      style={{ overflowX: 'auto', maxWidth: '100%' }}
    >
      <table data-testid="hb138-table">
        <thead>
          <tr>
            <th scope="col">{text('colId')}</th>
            <th scope="col">{text('colBooking')}</th>
            <th scope="col">{text('colReason')}</th>
            <th scope="col">{text('colEvidence')}</th>
            <th scope="col">{text('colTier')}</th>
            <th scope="col">{text('colAmounts')}</th>
            <th scope="col">{text('colStatus')}</th>
            <th scope="col">{text('colPeople')}</th>
            <th scope="col">{text('colPayout')}</th>
            <th scope="col">{text('colAction')}</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <RowView
              key={row.id}
              row={row}
              allowed={canAct(props.actor.role, props.actor.userId, row)}
              busy={props.busy}
              onAsk={props.onAsk}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Hộp thoại duyệt/từ chối: PIN bắt buộc, từ chối bắt buộc lý do; số tiền duyệt hiển thị, không sửa được. */
function DecisionDialog(props: {
  target: { row: RefundRequest; kind: 'approve' | 'reject' } | null;
  serverIssues: readonly FieldIssue[];
  onCancel: () => void;
  onConfirm: (id: string, kind: 'approve' | 'reject', note: string, pin: string) => void;
}): ReactElement {
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [local, setLocal] = useState<readonly FieldIssue[]>([]);
  const kind = props.target?.kind ?? 'approve';
  const issues = [...local, ...props.serverIssues];
  return (
    <ConfirmDialog
      id="hb138-dialog-decision"
      open={props.target !== null}
      title={kind === 'approve' ? text('approveTitle') : text('rejectTitle')}
      confirmLabel={text('confirm')}
      cancelLabel={text('cancel')}
      onCancel={props.onCancel}
      onConfirm={() => {
        const found = [...(kind === 'reject' ? rejectIssues(note) : []), ...pinIssues(pin)];
        setLocal(found);
        if (found.length > 0 || props.target === null) return;
        props.onConfirm(props.target.row.id, kind, note, pin);
        setPin('');
      }}
    >
      {kind === 'approve' && props.target !== null ? (
        <p>{text('approvedAmount', { amount: props.target.row.requestedAmount })}</p>
      ) : null}
      <TextInput
        name="decisionNote"
        label={kind === 'approve' ? text('decisionNote') : text('rejectNote')}
        value={note}
        issues={remap(issues, { note: 'decisionNote' })}
        onChange={(value) => {
          setLocal([]);
          setNote(value);
        }}
      />
      <p>{text('pinNote')}</p>
      <TextInput
        name="decisionPin"
        type="password"
        label={text('pin')}
        value={pin}
        issues={remap(issues, { pin: 'decisionPin' })}
        onChange={(value) => {
          setLocal([]);
          setPin(value);
        }}
      />
    </ConfirmDialog>
  );
}

export function ExceptionTable(props: {
  list: Rows | null;
  filter: Filter;
  actor: { role: UserMe['role']; userId: string };
  busy: boolean;
  serverIssues: readonly FieldIssue[];
  onMore: () => void;
  onDecide: (id: string, kind: 'approve' | 'reject', note: string, pin: string) => void;
}): ReactElement {
  const [target, setTarget] = useState<{ row: RefundRequest; kind: 'approve' | 'reject' } | null>(
    null,
  );
  const rows = visibleRows(props.list?.rows ?? [], props.filter);
  return (
    <section style={box} aria-labelledby="hb138-list-title" data-testid="hb138-list">
      <h2 id="hb138-list-title">{text('listLabel')}</h2>
      {props.list === null ? null : (
        <p>
          {text('total', {
            shown: rows.length,
            loaded: props.list.rows.length,
            total: props.list.total,
          })}
        </p>
      )}
      {rows.length === 0 ? (
        props.list === null ? null : (
          <p>{text('noRows')}</p>
        )
      ) : (
        <Table
          rows={rows}
          actor={props.actor}
          busy={props.busy}
          onAsk={(row, kind) => setTarget({ row, kind })}
        />
      )}
      <p>{text('evidenceNoOpen')}</p>
      {props.list?.nextCursor === null || props.list === null ? null : (
        <button
          type="button"
          onClick={props.onMore}
          style={{ minHeight: 44, justifySelf: 'start' }}
        >
          {text('loadMore')}
        </button>
      )}
      <DecisionDialog
        target={target}
        serverIssues={props.serverIssues}
        onCancel={() => setTarget(null)}
        onConfirm={(id, kind, note, pin) => {
          setTarget(null);
          props.onDecide(id, kind, note, pin);
        }}
      />
    </section>
  );
}
