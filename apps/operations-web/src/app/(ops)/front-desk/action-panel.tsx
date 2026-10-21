'use client';
import type { ReactElement } from 'react';
import { color, radius, space, typography } from '@pinehill/ui-web';
import type { RoomSummary } from '@pinehill/contracts';
import type { DeskApi } from './front-desk-api';
import { CONTROL, type DeskPanel } from './desk-tables';
import { CheckInPanel } from './check-in-panel';
import { CheckOutPanel, NoShowPanel } from './stay-panels';
import { deskText } from './messages';

export function ActionPanel({
  panel,
  rooms,
  api,
  pinToken,
  onClose,
  onDone,
  onInspect,
}: {
  panel: DeskPanel;
  rooms: readonly RoomSummary[];
  api: DeskApi;
  pinToken: { current: string | null };
  onClose: () => void;
  onDone: () => void;
  onInspect: () => void;
}): ReactElement {
  const title =
    panel.kind === 'checkIn'
      ? deskText('checkInTitle', { code: panel.booking.code })
      : panel.kind === 'checkOut'
        ? deskText('checkOutTitle', { code: panel.booking.code })
        : deskText('noShowTitle', { code: panel.booking.code });
  return (
    <section
      aria-labelledby="desk-action-title"
      data-testid="desk-action"
      style={{
        border: `1px solid ${color.borderStrong}`,
        borderRadius: radius.md,
        padding: space.s4,
        display: 'grid',
        gap: space.s3,
      }}
    >
      <h2 id="desk-action-title" style={{ margin: 0, fontSize: typography.h2.web }}>
        {title}
      </h2>
      {panel.kind === 'checkIn' ? (
        <CheckInPanel
          booking={panel.booking}
          rooms={rooms}
          api={api}
          onDone={onDone}
          onInspect={onInspect}
        />
      ) : panel.kind === 'checkOut' ? (
        <CheckOutPanel
          booking={panel.booking}
          api={api}
          pinToken={pinToken}
          onDone={onDone}
          onInspect={onInspect}
        />
      ) : (
        <NoShowPanel booking={panel.booking} api={api} onDone={onDone} onInspect={onInspect} />
      )}
      <button type="button" style={CONTROL} onClick={onClose}>
        {deskText('panelClose')}
      </button>
    </section>
  );
}
