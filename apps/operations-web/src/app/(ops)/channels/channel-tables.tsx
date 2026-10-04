'use client';

/** Bảng kênh và bảng ghi đè theo cơ sở của SCR-28 (tách khỏi màn hình cho gọn). */
import type { ReactElement } from 'react';
import type { ChannelDetail, ChannelSummary } from '@pinehill/contracts';
import { formatMultiplier } from '@pinehill/ui-web';
import { t } from '../../../lib/i18n';
import { channelWarnings, floorMultiplier, type ChannelWarning } from '../../../lib/channels';

const WARNING_LABEL: Readonly<
  Record<ChannelWarning, 'channels.warn.belowFloor' | 'channels.warn.directBelowOne'>
> = {
  belowFloor: 'channels.warn.belowFloor',
  directBelowOne: 'channels.warn.directBelowOne',
};

/** Ngưỡng sàn hiển thị: `1/(1 − hoa hồng)`; hoa hồng ≥ 100% thì không có ngưỡng. */
export function floorText(channel: ChannelSummary): string {
  const floor = floorMultiplier(channel.commissionPct);
  return floor === null ? t('channels.floor.undefined') : formatMultiplier(floor);
}

export function ChannelTable({
  channels,
  selectedId,
  onEdit,
}: {
  channels: readonly ChannelSummary[];
  selectedId: string | null;
  onEdit: (channel: ChannelSummary) => void;
}): ReactElement {
  const headers = [
    t('channels.col.code'),
    t('channels.col.name'),
    t('channels.col.multiplier'),
    t('channels.col.commission'),
    t('channels.col.floor'),
    t('channels.col.hold'),
    t('channels.col.overbook'),
    t('channels.col.version'),
    t('channels.col.actions'),
  ];
  return (
    <div style={{ overflowX: 'auto' }}>
      <table data-testid="channels-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <caption style={{ textAlign: 'start', padding: 'var(--space-s2, 8px) 0' }}>
          {t('channels.title')}
        </caption>
        <thead>
          <tr>
            {headers.map((label) => (
              <th
                key={label}
                scope="col"
                style={{ textAlign: 'start', borderBottom: '1px solid var(--color-border)' }}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {channels.map((channel) => {
            const warnings = channelWarnings(channel);
            return (
              <tr key={channel.id} data-testid={`channel-${channel.code}`}>
                <td>{channel.code}</td>
                <td>{channel.name}</td>
                <td>{formatMultiplier(channel.multiplier)}</td>
                <td>{channel.commissionPct}</td>
                <td data-testid={`channel-floor-${channel.code}`}>{floorText(channel)}</td>
                <td>{channel.holdMinutes}</td>
                <td>{channel.overbookAllowed ? t('channels.yes') : t('channels.no')}</td>
                <td>{channel.version}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => onEdit(channel)}
                    aria-pressed={selectedId === channel.id}
                    style={{ minHeight: 44 }}
                  >
                    {t('channels.edit')}
                  </button>
                  {warnings.length === 0 ? null : (
                    <ul data-testid={`channel-warnings-${channel.code}`} style={{ margin: 0 }}>
                      {warnings.map((warning) => (
                        <li key={warning}>{t(WARNING_LABEL[warning])}</li>
                      ))}
                    </ul>
                  )}
                  {channel.code === 'AGENCY' ? (
                    <span data-testid="channel-agency-exempt">{t('channels.agencyExempt')}</span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function OverrideTable({ channel }: { channel: ChannelDetail }): ReactElement {
  const headers = [
    t('channels.override.property'),
    t('channels.override.multiplier'),
    t('channels.override.commission'),
    t('channels.override.effectiveFrom'),
  ];
  return (
    <div style={{ overflowX: 'auto' }}>
      <table data-testid="channel-overrides" style={{ borderCollapse: 'collapse' }}>
        <caption style={{ textAlign: 'start' }}>
          {t('channels.override.title')} · {channel.code}
        </caption>
        <thead>
          <tr>
            {headers.map((label) => (
              <th
                key={label}
                scope="col"
                style={{ textAlign: 'start', borderBottom: '1px solid var(--color-border)' }}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {channel.propertyOverrides.map((row) => (
            <tr key={`${row.propertyId}-${row.effectiveFrom}`}>
              <td>{row.propertyId}</td>
              <td>{row.multiplier === undefined ? '—' : formatMultiplier(row.multiplier)}</td>
              <td>{row.commissionPct === undefined ? '—' : row.commissionPct}</td>
              <td>{row.effectiveFrom}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
