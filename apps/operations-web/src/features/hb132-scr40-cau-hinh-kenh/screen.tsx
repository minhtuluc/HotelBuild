'use client';
import type { ReactElement } from 'react';
import type { ChannelSummary } from '@pinehill/contracts';
import { space } from '@pinehill/ui-web';
import {
  OPS_COMPACT_BTN_STYLE,
  OPS_FILTER_ROW_STYLE,
  OPS_HEADER_STYLE,
  OPS_INTRO_STYLE,
  OPS_PAGE_STYLE,
  OPS_SUBTITLE_STYLE,
  OPS_TABLE_WRAP_STYLE,
  OPS_TABULAR_STYLE,
  OPS_TITLE_STYLE,
  opsNoticeStyle,
} from '../../components/editorial-styles';
import { ClosureForm, MappingForm } from './forms';
import { text } from './messages';
import { canClose, canMap, type FieldIssue } from './model';
import { ClosureTable, SelectInput, TextInput, box } from './parts';
import { CommandStatus, ReadBanner } from './status';
import type { ConfigController, ControllerState } from './controller';
import type { ConfigData } from './port';
import { mappingKey } from './controller';
import { useConfig } from './use-config';

function serverIssues(state: ControllerState): readonly FieldIssue[] {
  const { command } = state;
  return command.kind === 'failed' && command.failure.kind === 'validation'
    ? command.failure.issues
    : [];
}

function Selectors({
  state,
  controller,
}: {
  state: ControllerState;
  controller: ConfigController;
}): ReactElement | null {
  const data = state.data;
  if (data === null) return null;
  const { selection } = data;
  const options = <T extends { id: string }>(rows: readonly T[], label: (row: T) => string) =>
    rows.map((row) => ({ id: row.id, label: label(row) }));
  return (
    <div
      className="ph-card"
      style={{
        ...OPS_FILTER_ROW_STYLE,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
      }}
    >
      <SelectInput
        name="propertyId"
        label={text('property')}
        value={selection.propertyId ?? ''}
        options={options(data.properties, (row) => row.name)}
        onChange={(id) => void controller.select({ propertyId: id })}
      />
      <SelectInput
        name="channelId"
        label={text('channel')}
        value={selection.channelId ?? ''}
        options={options(data.channels, (row) => row.name)}
        onChange={(id) => void controller.select({ channelId: id })}
      />
      <SelectInput
        name="selectRoomTypeId"
        label={text('roomType')}
        value={selection.roomTypeId ?? ''}
        options={options(data.roomTypes, (row) => row.code)}
        onChange={(id) => void controller.select({ roomTypeId: id })}
      />
      <TextInput
        name="rangeFrom"
        type="date"
        label={text('from')}
        value={selection.range.from}
        issues={[]}
        onChange={(from) => void controller.select({ range: { ...selection.range, from } })}
      />
      <TextInput
        name="rangeTo"
        type="date"
        label={text('to')}
        value={selection.range.to}
        issues={[]}
        onChange={(to) => void controller.select({ range: { ...selection.range, to } })}
      />
    </div>
  );
}

const RATE_WARNING_TEXT = {
  E_RATE_CHANNEL_PARITY: 'rateParity',
  E_RATE_DIRECT_BELOW_BASE: 'rateDirectBelowBase',
} as const;

/** Cảnh báo giá đọc thẳng từ `rateWarnings` do máy chủ trả; giao diện không so sánh hệ số/hoa hồng. */
function RateWarnings({ channel }: { channel: ChannelSummary }): ReactElement | null {
  const warnings = channel.rateWarnings ?? [];
  if (warnings.length === 0) return null;
  return (
    <div data-testid="hb132-rate-warning" style={opsNoticeStyle('warning')}>
      {warnings.map((code) => (
        <p key={code} role="status" style={{ margin: 0 }}>
          {text(RATE_WARNING_TEXT[code])}
        </p>
      ))}
      <p style={{ margin: 0 }}>{text('rateScope')}</p>
    </div>
  );
}

/** Số liệu đúng như máy chủ trả; không cộng allotment các kênh, không tính lại trần hay tồn. */
export function Projection({ state }: { state: ControllerState }): ReactElement | null {
  const data = state.data;
  if (data === null) return null;
  const { selection } = data;
  const property = data.properties.find((row) => row.id === selection.propertyId);
  const channel = data.channels.find((row) => row.id === selection.channelId);
  const type = data.roomTypes.find((row) => row.id === selection.roomTypeId);
  if (property === undefined || channel === undefined || type === undefined) return null;
  return (
    <section
      className="ph-card"
      style={{ ...box, padding: space.s4 }}
      aria-labelledby="hb132-config-title"
      data-testid="hb132-config"
    >
      <h2 id="hb132-config-title" style={OPS_SUBTITLE_STYLE}>
        {text('scope', { name: property.name, channel: channel.name, roomType: type.code })}
      </h2>
      <p style={{ margin: 0 }}>{text('ceiling', { pct: property.overbookLimitPct })}</p>
      <p style={{ margin: 0 }}>
        {type.sellingUnits === undefined
          ? text('sellingUnitsUnknown')
          : text('sellingUnits', { units: type.sellingUnits })}
      </p>
      <p style={{ margin: 0 }}>
        {text('overbookAllowed', { value: channel.overbookAllowed ? text('yes') : text('no') })}
      </p>
      <RateWarnings channel={channel} />
      {data.rows.length === 0 ? (
        <p style={{ margin: 0 }}>{text('noRows')}</p>
      ) : (
        <div
          role="region"
          aria-label={text('tableLabel')}
          tabIndex={0}
          style={OPS_TABLE_WRAP_STYLE}
        >
          <table data-testid="hb132-allotments" style={OPS_TABULAR_STYLE}>
            <thead>
              <tr>
                <th scope="col">{text('colDate')}</th>
                <th scope="col">{text('colAllotment')}</th>
                <th scope="col">{text('colUsed')}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.date}>
                  <th scope="row">{row.date}</th>
                  <td>{row.allotment}</td>
                  <td>{row.used}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Confirmed state={state} />
    </section>
  );
}

function Confirmed({ state }: { state: ControllerState }): ReactElement | null {
  const { data } = state;
  const { channelId, roomTypeId } = data?.selection ?? { channelId: null, roomTypeId: null };
  if (channelId === null || roomTypeId === null) return null;
  const confirmed = state.confirmed[mappingKey(channelId, roomTypeId)];
  if (confirmed === undefined) return null;
  return (
    <p role="status" data-testid="hb132-confirmed-mapping" style={opsNoticeStyle('success')}>
      {text('confirmedMapping', {
        code: confirmed.mapping.providerRoomTypeCode,
        pct: confirmed.mapping.allotmentPct,
        version: confirmed.mapping.version,
      })}
    </p>
  );
}

function Forms({
  state,
  controller,
  data,
}: {
  state: ControllerState;
  controller: ConfigController;
  data: ConfigData;
}): ReactElement {
  const role = state.actor?.role;
  const busy = state.command.kind === 'sending';
  const roomTypeId = data.selection.roomTypeId ?? '';
  return (
    <>
      {role !== undefined && canMap(role) ? (
        <MappingForm
          roomTypes={data.roomTypes}
          roomTypeId={roomTypeId}
          serverIssues={serverIssues(state)}
          busy={busy}
          onSubmit={(draft) => void controller.submitMapping(draft)}
        />
      ) : (
        <p>{text('mappingOwnerOnly')}</p>
      )}
      {role !== undefined && canClose(role) ? (
        <>
          <ClosureForm
            roomTypes={data.roomTypes}
            roomTypeId={roomTypeId}
            date={data.selection.range.from}
            serverIssues={serverIssues(state)}
            busy={busy}
            onSubmit={(draft) => void controller.submitClosure(draft)}
          />
          {state.closure === null ? (
            <p>{text('closureNone')}</p>
          ) : (
            <ClosureTable rows={state.closure.rows} />
          )}
        </>
      ) : null}
    </>
  );
}

function Workspace({
  state,
  controller,
  data,
}: {
  state: ControllerState;
  controller: ConfigController;
  data: ConfigData;
}): ReactElement {
  return (
    <>
      <button
        type="button"
        className="ph-btn"
        disabled={state.command.kind === 'sending'}
        onClick={() => void controller.load()}
        style={{ ...OPS_COMPACT_BTN_STYLE, justifySelf: 'start' }}
      >
        {text('reload')}
      </button>
      <Selectors state={state} controller={controller} />
      {data.selection.roomTypeId === null || data.selection.channelId === null ? (
        <p>{text('empty')}</p>
      ) : (
        <>
          <Projection state={state} />
          <div aria-live="polite" data-testid="hb132-command">
            <CommandStatus
              command={state.command}
              pending={state.pending}
              actions={{
                retry: () => void controller.retry(),
                lookup: () => void controller.load(),
                discard: () => controller.discardPending(),
              }}
            />
          </div>
          <Forms state={state} controller={controller} data={data} />
        </>
      )}
    </>
  );
}

export function ChannelConfigurationScreen(): ReactElement {
  const { state, controller } = useConfig();
  const denied = state.phase === 'forbidden' || state.phase === 'expired';
  return (
    <section style={OPS_PAGE_STYLE}>
      <header style={OPS_HEADER_STYLE}>
        <h1 style={OPS_TITLE_STYLE}>{text('title')}</h1>
        <p style={OPS_INTRO_STYLE}>{text('intro')}</p>
      </header>
      {denied ? (
        <p role="alert" style={opsNoticeStyle('danger')}>
          {text(state.phase === 'expired' ? 'expired' : 'forbidden')}
        </p>
      ) : null}
      <ReadBanner state={state} />
      {!denied && controller !== null && state.data !== null ? (
        <Workspace state={state} controller={controller} data={state.data} />
      ) : null}
    </section>
  );
}
