'use client';
import { useState, type ReactElement } from 'react';
import type { OtaBooking } from '@pinehill/contracts';
import { space } from '@pinehill/ui-web';
import { OPS_COMPACT_BTN_STYLE, OPS_SUBTITLE_STYLE } from '../../components/editorial-styles';
import { text } from './messages';
import { filterIssues, type FieldIssue, type Filter } from './model';
import { SelectInput, TextInput, box } from './parts';
import { STATUS_TEXT } from './table';

const STATUSES: readonly OtaBooking['status'][] = ['PENDING', 'PROCESSED', 'FAILED', 'QUARANTINED'];

export function FilterForm(props: {
  value: Filter;
  busy: boolean;
  onApply: (filter: Filter) => void;
}): ReactElement {
  const [draft, setDraft] = useState<Filter>(props.value);
  const [issues, setIssues] = useState<readonly FieldIssue[]>([]);
  const patch = (next: Partial<Filter>) => {
    setIssues([]);
    setDraft({ ...draft, ...next });
  };
  const options = [
    { id: '', label: text('all') },
    ...STATUSES.map((status) => ({ id: status, label: text(STATUS_TEXT[status]) })),
  ];
  return (
    <form
      aria-labelledby="hb134-filter-title"
      className="ph-card"
      style={{
        ...box,
        padding: space.s4,
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
        alignItems: 'end',
      }}
      onSubmit={(event) => {
        event.preventDefault();
        const found = filterIssues(draft);
        setIssues(found);
        if (found.length === 0) props.onApply(draft);
      }}
    >
      <h2 id="hb134-filter-title" style={{ ...OPS_SUBTITLE_STYLE, gridColumn: '1 / -1' }}>
        {text('filterTitle')}
      </h2>
      <SelectInput
        name="status"
        label={text('status')}
        value={draft.status ?? ''}
        options={options}
        onChange={(value) => patch({ status: STATUSES.find((status) => status === value) ?? null })}
      />
      <TextInput
        name="q"
        label={text('query')}
        value={draft.q}
        issues={issues}
        onChange={(value) => patch({ q: value })}
      />
      <TextInput
        name="from"
        type="date"
        label={text('from')}
        value={draft.from}
        issues={issues}
        onChange={(value) => patch({ from: value })}
      />
      <TextInput
        name="to"
        type="date"
        label={text('to')}
        value={draft.to}
        issues={issues}
        onChange={(value) => patch({ to: value })}
      />
      <button
        type="submit"
        className="ph-btn-primary"
        disabled={props.busy}
        style={{ ...OPS_COMPACT_BTN_STYLE, justifySelf: 'start' }}
        data-testid="hb134-apply"
      >
        {text('apply')}
      </button>
    </form>
  );
}
