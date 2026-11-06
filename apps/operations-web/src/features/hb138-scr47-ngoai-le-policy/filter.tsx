'use client';
import { useState, type ReactElement } from 'react';
import type { PropertySummary } from '@pinehill/contracts';
import { text } from './messages';
import { filterIssues, type FieldIssue, type Filter } from './model';
import { SelectInput, TextInput, box } from './parts';
import { STATUS_TEXT } from './table';

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED'] as const;

export function FilterForm(props: {
  value: Filter;
  properties: readonly PropertySummary[];
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
  return (
    <form
      aria-labelledby="hb138-filter-title"
      style={{ ...box, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))' }}
      onSubmit={(event) => {
        event.preventDefault();
        const found = filterIssues(draft);
        setIssues(found);
        if (found.length === 0) props.onApply(draft);
      }}
    >
      <h2 id="hb138-filter-title" style={{ gridColumn: '1 / -1' }}>
        {text('filterTitle')}
      </h2>
      <SelectInput
        name="propertyId"
        label={text('property')}
        value={draft.propertyId}
        options={[all, ...props.properties.map((row) => ({ id: row.id, label: row.name }))]}
        onChange={(value) => patch({ propertyId: value })}
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
        name="bookingFilter"
        label={text('bookingFilter')}
        value={draft.bookingId}
        issues={issues.map((item) => ({ ...item, field: 'bookingFilter' }))}
        onChange={(value) => patch({ bookingId: value })}
      />
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
        <input
          type="checkbox"
          name="forceOnly"
          checked={draft.forceOnly}
          onChange={(event) => patch({ forceOnly: event.target.checked })}
        />
        {text('forceOnly')}
      </label>
      <button
        type="submit"
        disabled={props.busy}
        style={{ minHeight: 44, justifySelf: 'start' }}
        data-testid="hb138-apply"
      >
        {text('apply')}
      </button>
    </form>
  );
}
