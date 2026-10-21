'use client';
import { useState, type ReactElement } from 'react';
import {
  StateSurface,
  color,
  formatDateTimeVn,
  radius,
  space,
  touchTargetPx,
  typography,
  type ScreenState,
} from '@pinehill/ui-web';
import { useForcedState } from '../../../components/forced-state';
import { ScreenAlert } from '../../../components/screen-alert';
import { t } from '../../../lib/i18n';
import { formatBusinessDate } from '../../../lib/business-date';
import { useFrontDesk, type DeskState, type FrontDeskSession } from './use-front-desk';
import { deskEmpty } from './front-desk-model';
import { ActionPanel } from './action-panel';
import { DeskTables, type DeskPanel } from './desk-tables';
import { WalkInPanel } from './walk-in-panel';
import { deskText } from './messages';

function surface(state: DeskState): ScreenState {
  if (state.phase === 'forbidden') return { kind: 'forbidden' };
  if (state.data === null)
    return state.phase === 'loading' ? { kind: 'loading' } : { kind: 'ready' };
  if (state.phase === 'loading')
    return { kind: 'refreshing', updatedAt: state.data.capturedAt, stale: false };
  if (deskEmpty(state.data)) return { kind: 'empty', reason: 'noData', canCreate: false };
  return { kind: 'ready' };
}

function ForcedDesk({ state }: { state: ScreenState }): ReactElement {
  return (
    <section data-testid="front-desk-screen" style={{ display: 'grid', gap: 12 }}>
      <h1 style={{ margin: 0, fontSize: typography.h1.web }}>{deskText('title')}</h1>
      <StateSurface state={state}>
        <p>{t('screen.demo')}</p>
      </StateSurface>
    </section>
  );
}

function DeskControls({
  desk,
  onSelect,
  onWalkIn,
}: {
  desk: FrontDeskSession;
  onSelect: (propertyId: string) => void;
  onWalkIn: () => void;
}): ReactElement {
  const data = desk.state.data;
  const button = {
    minHeight: touchTargetPx,
    border: `1px solid ${color.borderStrong}`,
    borderRadius: radius.sm,
    padding: space.s2,
    background: color.surface,
  } as const;
  return (
    <div
      style={{ display: 'flex', flexWrap: 'wrap', gap: space.s3, alignItems: 'end' }}
      aria-label={deskText('title')}
    >
      <label style={{ display: 'grid', gap: 4 }}>
        {deskText('property')}
        <select
          name="propertyId"
          style={button}
          value={data?.propertyId ?? ''}
          disabled={data === null}
          onChange={(event) => {
            onSelect(event.target.value);
          }}
        >
          {(data?.properties ?? []).map((property) => (
            <option key={property.id} value={property.id}>
              {property.name}
            </option>
          ))}
        </select>
      </label>
      <p style={{ margin: 0 }} data-testid="desk-date">
        {deskText('businessDate')}: {formatBusinessDate(desk.date)}
      </p>
      <button
        type="button"
        style={button}
        disabled={data === null || desk.state.phase === 'loading'}
        onClick={desk.reload}
      >
        {deskText('reload')}
      </button>
      <button
        type="button"
        data-testid="walk-in-open"
        style={button}
        disabled={data === null}
        onClick={onWalkIn}
      >
        {deskText('walkIn')}
      </button>
    </div>
  );
}

function DeskMeta({ state, onRetry }: { state: DeskState; onRetry: () => void }): ReactElement {
  const data = state.data;
  return (
    <>
      {data === null ? null : (
        <p style={{ margin: 0 }} data-testid="desk-captured">
          {deskText('captured', { time: formatDateTimeVn(data.capturedAt) })}
        </p>
      )}
      {data?.truncated === true ? (
        <p role="status" style={{ margin: 0 }}>
          {deskText('truncated')}
        </p>
      ) : null}
      {state.error === null ? null : <ScreenAlert error={state.error} onRetry={onRetry} />}
    </>
  );
}

function Overlays({
  desk,
  panel,
  walkIn,
  setPanel,
  setWalkIn,
}: {
  desk: FrontDeskSession;
  panel: DeskPanel | null;
  walkIn: boolean;
  setPanel: (panel: DeskPanel | null) => void;
  setWalkIn: (value: boolean) => void;
}): ReactElement | null {
  const data = desk.state.data;
  if (data === null) return null;
  return (
    <>
      {panel === null ? null : (
        <ActionPanel
          panel={panel}
          rooms={data.rooms}
          api={desk.api}
          pinToken={desk.pinToken}
          onClose={() => {
            setPanel(null);
          }}
          onDone={desk.reload}
          onInspect={desk.reload}
        />
      )}
      {walkIn ? (
        <WalkInPanel
          api={desk.api}
          pinToken={desk.pinToken}
          date={desk.date}
          propertyId={data.propertyId}
          properties={data.properties}
          roomTypes={data.roomTypes}
          onClose={() => {
            setWalkIn(false);
          }}
          onDone={desk.reload}
          onInspect={desk.reload}
        />
      ) : null}
    </>
  );
}

/**
 * SCR-48 — bàn tiền sảnh: đến/đi/ở trong ngày + walk-in.
 *
 * AC1: không có phép tính nợ/sẵn sàng/mốc giờ ở client. Nút check-in gửi lệnh; máy chủ từ chối thì hiện
 * đúng mã + lý do máy chủ trả và liên kết thu tiền SCR-37. AC2: no-show/check-out nêu hệ quả chính sách
 * trước xác nhận; số tiền chỉ lấy từ phản hồi máy chủ (hợp đồng chưa có nguồn trước khi ghi — BLOCKED).
 */
export function FrontDeskScreen({ baseUrl }: { baseUrl: string }): ReactElement {
  const forced = useForcedState();
  const desk = useFrontDesk(baseUrl, forced === undefined);
  const [panel, setPanel] = useState<DeskPanel | null>(null);
  const [walkIn, setWalkIn] = useState(false);
  if (forced !== undefined) return <ForcedDesk state={forced} />;
  return (
    <section
      data-testid="front-desk-screen"
      style={{ display: 'grid', gap: space.s4, padding: `${space.s4} 0`, maxWidth: 1280 }}
    >
      <h1 style={{ margin: 0, fontSize: typography.h1.web }}>{deskText('title')}</h1>
      <p style={{ margin: 0, color: color.textMuted }}>{deskText('intro')}</p>
      <DeskControls
        desk={desk}
        onSelect={(propertyId) => {
          setPanel(null);
          desk.selectProperty(propertyId);
        }}
        onWalkIn={() => {
          setPanel(null);
          setWalkIn(true);
        }}
      />
      <DeskMeta state={desk.state} onRetry={desk.reload} />
      <StateSurface state={surface(desk.state)}>
        {desk.state.data === null ? null : (
          <DeskTables
            arrivals={desk.state.data.arrivals}
            inHouse={desk.state.data.inHouse}
            departures={desk.state.data.departures}
            onAction={(next) => {
              setWalkIn(false);
              setPanel(next);
            }}
          />
        )}
      </StateSurface>
      <Overlays
        desk={desk}
        panel={panel}
        walkIn={walkIn}
        setPanel={setPanel}
        setWalkIn={setWalkIn}
      />
    </section>
  );
}
