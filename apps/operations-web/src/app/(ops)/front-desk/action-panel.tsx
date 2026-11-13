'use client';
import type { ReactElement } from 'react';
import { color, fontFamily, space, typography } from '@pinehill/ui-web';
import type { RoomSummary } from '@pinehill/contracts';
import type { DeskApi } from './front-desk-api';
import { type DeskPanel } from './desk-tables';
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
      className="ph-card"
      style={{
        border: `1px solid ${color.borderStrong}`,
        boxShadow: `inset 0 0 0 1px ${color.primary}`,
        display: 'grid',
        gap: space.s4,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: space.s2,
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: `1px solid ${color.border}`,
          paddingBottom: space.s3,
        }}
      >
        <h2
          id="desk-action-title"
          style={{ margin: 0, fontFamily: fontFamily.sans, fontSize: typography.h2.web }}
        >
          {title}
        </h2>
        <button type="button" className="ph-btn" onClick={onClose}>
          {deskText('panelClose')}
        </button>
      </div>
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
    </section>
  );
}
