'use client';
import { useState, type ReactElement } from 'react';
import { formatDateTimeVn, space } from '@pinehill/ui-web';
import type { OutboxDelivery } from '@pinehill/contracts';
import {
  OPS_COMPACT_BTN_STYLE,
  OPS_SUBTITLE_STYLE,
  OPS_TABLE_WRAP_STYLE,
  OPS_TABULAR_STYLE,
} from '../../components/editorial-styles';
import type { Deliveries, StatusFilter } from './controller';
import { text } from './messages';
import { ConfirmDialog, SelectInput, box } from './parts';

const STATUS_TEXT = {
  PENDING: 'stPending',
  PROCESSING: 'stProcessing',
  COMPLETED: 'stCompleted',
  DEAD_LETTER: 'stDeadLetter',
} as const;

const FILTERS: readonly OutboxDelivery['status'][] = [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'DEAD_LETTER',
];

const when = (value: string | null): string => (value === null ? '' : formatDateTimeVn(value));

/** `COMPLETED` đã xong nên không có gì để gửi lại; mọi trạng thái khác để máy chủ quyết định. */
const replayable = (row: OutboxDelivery): boolean => row.status !== 'COMPLETED';

function DeliveryRow({
  row,
  canReplay,
  busy,
  onAsk,
}: {
  row: OutboxDelivery;
  canReplay: boolean;
  busy: boolean;
  onAsk: (id: string) => void;
}): ReactElement {
  return (
    <tr data-testid={`hb133-delivery-${row.id}`}>
      <th scope="row">{row.eventType}</th>
      <td>{row.consumerKey}</td>
      <td>{text(STATUS_TEXT[row.status])}</td>
      <td>{row.attempts}</td>
      <td>{row.lastError ?? ''}</td>
      <td>{when(row.nextAttemptAt)}</td>
      <td>{when(row.createdAt)}</td>
      <td>{when(row.processedAt)}</td>
      {canReplay ? (
        <td>
          {replayable(row) ? (
            <button
              type="button"
              className="ph-btn"
              disabled={busy}
              onClick={() => onAsk(row.id)}
              style={OPS_COMPACT_BTN_STYLE}
              data-testid={`hb133-replay-${row.id}`}
            >
              {text('replay')}
            </button>
          ) : null}
        </td>
      ) : null}
    </tr>
  );
}

function DeliveryTable({
  rows,
  canReplay,
  busy,
  onAsk,
}: {
  rows: readonly OutboxDelivery[];
  canReplay: boolean;
  busy: boolean;
  onAsk: (id: string) => void;
}): ReactElement {
  return (
    <div role="region" aria-label={text('outboxLabel')} tabIndex={0} style={OPS_TABLE_WRAP_STYLE}>
      <table data-testid="hb133-deliveries" style={OPS_TABULAR_STYLE}>
        <thead>
          <tr>
            <th scope="col">{text('colEvent')}</th>
            <th scope="col">{text('colConsumer')}</th>
            <th scope="col">{text('colStatus')}</th>
            <th scope="col">{text('colAttempts')}</th>
            <th scope="col">{text('colError')}</th>
            <th scope="col">{text('colNext')}</th>
            <th scope="col">{text('colCreated')}</th>
            <th scope="col">{text('colProcessed')}</th>
            {canReplay ? <th scope="col">{text('colAction')}</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <DeliveryRow key={row.id} row={row} canReplay={canReplay} busy={busy} onAsk={onAsk} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OutboxSection(props: {
  deliveries: Deliveries | null;
  filter: StatusFilter;
  canReplay: boolean;
  busy: boolean;
  onFilter: (filter: StatusFilter) => void;
  onMore: () => void;
  onReplay: (deliveryId: string) => void;
}): ReactElement {
  const [target, setTarget] = useState<string | null>(null);
  const rows = props.deliveries?.rows ?? [];
  const options = [
    { id: '', label: text('all') },
    ...FILTERS.map((status) => ({ id: status, label: text(STATUS_TEXT[status]) })),
  ];
  return (
    <section
      className="ph-card"
      style={{ ...box, padding: space.s4 }}
      aria-labelledby="hb133-outbox-title"
      data-testid="hb133-outbox"
    >
      <h2 id="hb133-outbox-title" style={OPS_SUBTITLE_STYLE}>
        {text('outboxTitle')}
      </h2>
      <SelectInput
        name="statusFilter"
        label={text('statusFilter')}
        value={props.filter ?? ''}
        options={options}
        onChange={(value) => props.onFilter(FILTERS.find((status) => status === value) ?? null)}
      />
      {props.deliveries === null ? null : (
        <p style={{ margin: 0 }}>{text('total', { total: props.deliveries.total })}</p>
      )}
      {rows.length === 0 ? (
        props.deliveries === null ? null : (
          <p style={{ margin: 0 }}>{text('noDeliveries')}</p>
        )
      ) : (
        <DeliveryTable
          rows={rows}
          canReplay={props.canReplay}
          busy={props.busy}
          onAsk={setTarget}
        />
      )}
      {props.deliveries?.nextCursor === null || props.deliveries === null ? null : (
        <button
          type="button"
          className="ph-btn"
          onClick={props.onMore}
          style={{ ...OPS_COMPACT_BTN_STYLE, justifySelf: 'start' }}
        >
          {text('loadMore')}
        </button>
      )}
      <ConfirmDialog
        id="hb133-dialog-replay"
        open={target !== null}
        title={text('confirmReplay')}
        confirmLabel={text('replay')}
        cancelLabel={text('cancel')}
        onCancel={() => setTarget(null)}
        onConfirm={() => {
          const id = target;
          setTarget(null);
          if (id !== null) props.onReplay(id);
        }}
      >
        <p>{target}</p>
      </ConfirmDialog>
    </section>
  );
}
