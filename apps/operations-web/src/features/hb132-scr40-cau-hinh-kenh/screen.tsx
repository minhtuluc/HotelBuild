'use client';
import type { ReactElement } from 'react';
import type { ChannelSummary } from '@pinehill/contracts';
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
    <div style={{ ...box, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))' }}>
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
    <div data-testid="hb132-rate-warning">
      {warnings.map((code) => (
        <p key={code} role="status">
          {text(RATE_WARNING_TEXT[code])}
        </p>
      ))}
      <p>{text('rateScope')}</p>
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
    <section style={box} aria-labelledby="hb132-config-title" data-testid="hb132-config">
      <h2 id="hb132-config-title">
        {text('scope', { name: property.name, channel: channel.name, roomType: type.code })}
      </h2>
      <p>{text('ceiling', { pct: property.overbookLimitPct })}</p>
      <p>
        {type.sellingUnits === undefined
          ? text('sellingUnitsUnknown')
          : text('sellingUnits', { units: type.sellingUnits })}
      </p>
      <p>
        {text('overbookAllowed', { value: channel.overbookAllowed ? text('yes') : text('no') })}
      </p>
      <RateWarnings channel={channel} />
      {data.rows.length === 0 ? (
        <p>{text('noRows')}</p>
      ) : (
        <div
          role="region"
          aria-label={text('tableLabel')}
          tabIndex={0}
          style={{ overflowX: 'auto', maxWidth: '100%' }}
        >
          <table data-testid="hb132-allotments">
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
    <p role="status" data-testid="hb132-confirmed-mapping">
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
        disabled={state.command.kind === 'sending'}
        onClick={() => void controller.load()}
        style={{ minHeight: 44, justifySelf: 'start' }}
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
    <section style={{ padding: 'var(--space-s6, 24px)', ...box, gap: 'var(--space-s4, 16px)' }}>
      <h1 style={{ margin: 0 }}>{text('title')}</h1>
      <p>{text('intro')}</p>
      {denied ? (
        <p role="alert">{text(state.phase === 'expired' ? 'expired' : 'forbidden')}</p>
      ) : null}
      <ReadBanner state={state} />
      {!denied && controller !== null && state.data !== null ? (
        <Workspace state={state} controller={controller} data={state.data} />
      ) : null}
    </section>
  );
}
