'use client';
import { useState, type ReactElement } from 'react';
import type { PropertySummary, RoomTypeSummary } from '@pinehill/contracts';
import { text } from './messages';
import { filterIssues, type FieldIssue, type Filter } from './model';
import { SelectInput, TextInput, box } from './parts';
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
      style={{ ...box, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))' }}
      onSubmit={(event) => {
        event.preventDefault();
        const found = filterIssues(draft);
        setIssues(found);
        if (found.length === 0) props.onApply(draft);
      }}
    >
      <h2 id="hb135-filter-title" style={{ gridColumn: '1 / -1' }}>
        {text('filterTitle')}
      </h2>
      <p style={{ gridColumn: '1 / -1', margin: 0 }}>{text('filterNote')}</p>
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
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
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
        style={{ minHeight: 44, justifySelf: 'start' }}
        data-testid="hb135-apply"
      >
        {text('apply')}
      </button>
    </form>
  );
}
