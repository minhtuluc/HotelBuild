'use client';
import { useEffect, useState, type ReactElement } from 'react';
import { t } from '../../../lib/i18n';
import { defaultRange } from '../../../lib/inventory-grid';
import { validateDrafts } from '../../../lib/allotments';
import type { useAdmin } from '../admin-commands/use-admin';
export function AllotmentControls({
  model,
  onSelect,
}: {
  model: ReturnType<typeof useAdmin>;
  onSelect: () => void;
}): ReactElement {
  const { state, select, controller } = model,
    current = state.data?.allotment;
  const [pending, setPending] = useState(() => defaultRange(new Date()));
  useEffect(() => {
    if (current) setPending(current.range);
  }, [current?.range.from, current?.range.to]);
  const data = state.data;
  if (!data || !current || !controller || !select) return <></>;
  const disabled = !controller.canStart();
  const change = (next: import('../admin-commands/allotment-api').AllotmentSelection) => {
    if (select(next)) onSelect();
  };
  return (
    <form
      data-testid="allotment-controls"
      style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled) return;
        const issues = validateDrafts([], undefined, pending);
        if (issues.length) {
          controller.validation(issues);
          return;
        }
        if (select({ ...current, range: pending })) onSelect();
      }}
    >
      <label>
        {t('allotments.form.channel')}
        <select
          value={current.channelId}
          disabled={disabled}
          onChange={(event) => change({ ...current, channelId: event.target.value })}
        >
          {data.channels?.map((row) => (
            <option key={row.id} value={row.id}>
              {t(`enum.channelCode.${row.code}`)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('allotments.form.property')}
        <select
          value={current.propertyId}
          disabled={disabled}
          onChange={(event) =>
            change({
              propertyId: event.target.value,
              channelId: current.channelId,
              range: current.range,
            })
          }
        >
          {data.properties.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('allotments.form.roomType')}
        <select
          value={current.roomTypeId}
          disabled={disabled}
          onChange={(event) => change({ ...current, roomTypeId: event.target.value })}
        >
          {data.roomTypes
            .filter((row) => row.propertyId === current.propertyId)
            .map((row) => (
              <option key={row.id} value={row.id}>
                {row.code}
              </option>
            ))}
        </select>
      </label>
      <label>
        {t('allotments.form.from')}
        <input
          type="date"
          value={pending.from}
          disabled={disabled}
          onChange={(event) => setPending({ ...pending, from: event.target.value })}
        />
      </label>
      <label>
        {t('allotments.form.to')}
        <input
          type="date"
          value={pending.to}
          disabled={disabled}
          onChange={(event) => setPending({ ...pending, to: event.target.value })}
        />
      </label>
      <button type="submit" disabled={disabled} style={{ minHeight: 44 }}>
        {t('allotments.form.load')}
      </button>
    </form>
  );
}
