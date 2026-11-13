'use client';
import { useState, type ReactElement } from 'react';
import { color, fontFamily, space, typography } from '@pinehill/ui-web';
import type { PropertySummary, RoomTypeSummary } from '@pinehill/contracts';
import { text } from './messages';
import { filterIssues, type FieldIssue, type Filter } from './model';
import { SelectInput, TextInput } from './parts';
import { STATUS_TEXT } from './table';

const STATUSES = ['OPEN', 'PROPOSED', 'RESOLVED', 'ESCALATED'] as const;

export function FilterForm(props: {
  value: Filter;
  properties: readonly PropertySummary[];
  roomTypes: readonly RoomTypeSummary[];
  busy: boolean;
  onApply: (filter: Filter) => void;
}): ReactElement {
  const [draft, setDraft] = useState<Filter>(props.value);
  const [issues, setIssues] = useState<readonly FieldIssue[]>([]);
  const patch = (next: Partial<Filter>) => {
    setIssues([]);
    setDraft({ ...draft, ...next });
  };
  const all = { id: '', label: text('all') };
  const types = props.roomTypes.filter(
    (type) => draft.propertyId === '' || type.propertyId === draft.propertyId,
  );
  return (
    <form
      aria-labelledby="hb135-filter-title"
      className="ph-card"
      style={{
        display: 'grid',
        gap: space.s3,
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',
        alignItems: 'end',
        padding: space.s4,
        minWidth: 0,
      }}
      onSubmit={(event) => {
        event.preventDefault();
        const found = filterIssues(draft);
        setIssues(found);
        if (found.length === 0) props.onApply(draft);
      }}
    >
      <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 4 }}>
        <h2
          id="hb135-filter-title"
          style={{ margin: 0, fontFamily: fontFamily.sans, fontSize: typography.h2.web }}
        >
          {text('filterTitle')}
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: color.textMuted }}>{text('filterNote')}</p>
      </div>
      <SelectInput
        name="propertyId"
        label={text('property')}
        value={draft.propertyId}
        options={[all, ...props.properties.map((row) => ({ id: row.id, label: row.name }))]}
        onChange={(value) => patch({ propertyId: value, roomTypeId: '' })}
      />
      <SelectInput
        name="roomTypeId"
        label={text('roomType')}
        value={draft.roomTypeId}
        options={[all, ...types.map((row) => ({ id: row.id, label: row.code }))]}
        onChange={(value) => patch({ roomTypeId: value })}
      />
      <SelectInput
        name="status"
        label={text('status')}
        value={draft.status ?? ''}
        options={[
          all,
          ...STATUSES.map((status) => ({ id: status, label: text(STATUS_TEXT[status]) })),
        ]}
        onChange={(value) => patch({ status: STATUSES.find((status) => status === value) ?? null })}
      />
      <TextInput
        name="dateFrom"
        type="date"
        label={text('dateFrom')}
        value={draft.dateFrom}
        issues={issues}
        onChange={(value) => patch({ dateFrom: value })}
      />
      <TextInput
        name="dateTo"
        type="date"
        label={text('dateTo')}
        value={draft.dateTo}
        issues={issues}
        onChange={(value) => patch({ dateTo: value })}
      />
      <label
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          minHeight: 44,
          fontSize: 14,
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          name="overdueOnly"
          checked={draft.overdueOnly}
          onChange={(event) => patch({ overdueOnly: event.target.checked })}
        />
        {text('overdueOnly')}
      </label>
      <button
        type="submit"
        disabled={props.busy}
        className="ph-btn-primary"
        style={{ justifySelf: 'start' }}
        data-testid="hb135-apply"
      >
        {text('apply')}
      </button>
    </form>
  );
}
