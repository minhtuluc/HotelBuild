'use client';
import { useState, type ReactElement } from 'react';
import { formatDateTimeVn, formatMoney } from '@pinehill/ui-web';
import type { OtaBooking } from '@pinehill/contracts';
import type { Rows } from './controller';
import { text } from './messages';
import { flagIssues, type FieldIssue, type FlagDraft } from './model';
import { ConfirmDialog, TextInput, box } from './parts';

export const STATUS_TEXT = {
  PENDING: 'stPending',
  PROCESSED: 'stProcessed',
  FAILED: 'stFailed',
  QUARANTINED: 'stQuarantined',
} as const;

const EVENT_TEXT = {
  'booking.created': 'evCreated',
  'booking.modified': 'evModified',
  'booking.cancelled': 'evCancelled',
} as const;

const when = (value: string | null): string =>
  value === null ? text('none') : formatDateTimeVn(value);

const eventLabel = (row: OtaBooking): string =>
  row.eventType === null ? text('none') : text(EVENT_TEXT[row.eventType]);

/** Liên kết tới case quá tải do máy chủ chỉ ra (cùng đích với SCR-43); không có case thì để trống. */
function CaseCell({ id }: { id: string | null | undefined }): ReactElement {
  if (id === null || id === undefined) return <>{text('none')}</>;
  return (
    <a href={`/overbooking/relocation?caseId=${encodeURIComponent(id)}`}>{text('openCase')}</a>
  );
}

/** Khoản OTA thu hộ đọc từ sổ cái do máy chủ trả; không có thì để trống, không suy từ số tiền booking. */
function collection(row: OtaBooking): string {
  if (row.paymentMethod !== 'OTA_COLLECT') return text('none');
  const amount = row.collectedAmount;
  return amount === null || amount === undefined
    ? text('otaCollect')
    : `${text('otaCollect')} — ${text('collected', { amount: formatMoney(amount) })}`;
}

/** Cảnh báo đối soát đọc thẳng từ cờ máy chủ trả; không suy thêm từ trạng thái hay số liệu. */
function flags(row: OtaBooking): string[] {
  const out: string[] = [];
  if (row.oversold) out.push(text('oversold'));
  if (row.duplicate) out.push(text('duplicate'));
  if (row.flagged) out.push(text('flagged', { reason: row.flagReason ?? text('none') }));
  return out;
}

function Row({
  row,
  canFlag,
  busy,
  onAsk,
}: {
  row: OtaBooking;
  canFlag: boolean;
  busy: boolean;
  onAsk: (row: OtaBooking) => void;
}): ReactElement {
  const warnings = flags(row);
  return (
    <tr data-testid={`hb134-row-${row.id}`}>
      <th scope="row">{row.providerBookingCode}</th>
      <td>{eventLabel(row)}</td>
      <td>{text(STATUS_TEXT[row.status])}</td>
      <td>
        {row.bookingId === null ? (
          text('unlinked')
        ) : (
          <a href={`/bookings/${encodeURIComponent(row.bookingId)}`}>{row.bookingId}</a>
        )}
      </td>
      <td>{row.guestNameMasked ?? text('none')}</td>
      <td>{when(row.receivedAt)}</td>
      <td>{when(row.processedAt)}</td>
      <td>{collection(row)}</td>
      <td>{row.channelPolicyCode ?? text('none')}</td>
      <td>
        <CaseCell id={row.overbookingCaseId} />
      </td>
      <td>
        {warnings.length === 0 ? text('none') : warnings.map((item) => <p key={item}>{item}</p>)}
        {row.errorCode === null ? null : <p>{row.errorCode}</p>}
      </td>
      {canFlag ? (
        <td>
          <button
            type="button"
            disabled={busy}
            onClick={() => onAsk(row)}
            style={{ minHeight: 44 }}
            data-testid={`hb134-flag-${row.id}`}
          >
            {row.flagged ? text('unflag') : text('flag')}
          </button>
        </td>
      ) : null}
    </tr>
  );
}

function Table(props: {
  rows: readonly OtaBooking[];
  canFlag: boolean;
  busy: boolean;
  onAsk: (row: OtaBooking) => void;
}): ReactElement {
  return (
    <div
      role="region"
      aria-label={text('listLabel')}
      tabIndex={0}
      style={{ overflowX: 'auto', maxWidth: '100%' }}
    >
      <table data-testid="hb134-table">
        <thead>
          <tr>
            <th scope="col">{text('colCode')}</th>
            <th scope="col">{text('colEvent')}</th>
            <th scope="col">{text('colStatus')}</th>
            <th scope="col">{text('colBooking')}</th>
            <th scope="col">{text('colGuest')}</th>
            <th scope="col">{text('colReceived')}</th>
            <th scope="col">{text('colProcessed')}</th>
            <th scope="col">{text('colCollect')}</th>
            <th scope="col">{text('colPolicy')}</th>
            <th scope="col">{text('colCase')}</th>
            <th scope="col">{text('colFlags')}</th>
            {props.canFlag ? <th scope="col">{text('colAction')}</th> : null}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <Row
              key={row.id}
              row={row}
              canFlag={props.canFlag}
              busy={props.busy}
              onAsk={props.onAsk}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Hộp thoại gắn/gỡ cờ: bắt buộc lý do; bản nhập được giữ khi máy chủ từ chối. */
function FlagDialog(props: {
  target: OtaBooking | null;
  serverIssues: readonly FieldIssue[];
  onCancel: () => void;
  onConfirm: (draft: FlagDraft) => void;
}): ReactElement {
  const [reason, setReason] = useState('');
  const [local, setLocal] = useState<readonly FieldIssue[]>([]);
  const draft = { flagged: props.target?.flagged !== true, reason };
  return (
    <ConfirmDialog
      id="hb134-dialog-flag"
      open={props.target !== null}
      title={draft.flagged ? text('flag') : text('unflag')}
      confirmLabel={text('confirmFlag')}
      cancelLabel={text('cancel')}
      onCancel={props.onCancel}
      onConfirm={() => {
        const found = flagIssues(draft);
        setLocal(found);
        if (found.length === 0) props.onConfirm(draft);
      }}
    >
      <p>{text('flagNote')}</p>
      <TextInput
        name="reason"
        label={text('reason')}
        value={reason}
        issues={[...local, ...props.serverIssues]}
        onChange={(value) => {
          setLocal([]);
          setReason(value);
        }}
      />
    </ConfirmDialog>
  );
}

export function OtaTable(props: {
  list: Rows | null;
  canFlag: boolean;
  busy: boolean;
  serverIssues: readonly FieldIssue[];
  onMore: () => void;
  onFlag: (bookingId: string, draft: FlagDraft) => void;
}): ReactElement {
  const [target, setTarget] = useState<OtaBooking | null>(null);
  const rows = props.list?.rows ?? [];
  return (
    <section style={box} aria-labelledby="hb134-list-title" data-testid="hb134-list">
      <h2 id="hb134-list-title">{text('listLabel')}</h2>
      {props.list === null ? null : <p>{text('total', { total: props.list.total })}</p>}
      {rows.length === 0 ? (
        props.list === null ? null : (
          <p>{text('noRows')}</p>
        )
      ) : (
        <Table rows={rows} canFlag={props.canFlag} busy={props.busy} onAsk={setTarget} />
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
      <FlagDialog
        target={target}
        serverIssues={props.serverIssues}
        onCancel={() => setTarget(null)}
        onConfirm={(draft) => {
          const id = target?.id;
          setTarget(null);
          if (id !== undefined) props.onFlag(id, draft);
        }}
      />
    </section>
  );
}
