'use client';
import { useState, type ReactElement } from 'react';
import { text } from './messages';
import { charCount, createIssues, emptyCreate, type CreateDraft, type FieldIssue } from './model';
import { ConfirmDialog, SelectInput, TextInput, box } from './parts';

const REASONS = [
  { id: 'FORCE_MAJEURE', key: 'rsForce' },
  { id: 'HOTEL_RELOCATION', key: 'rsRelocation' },
  { id: 'OTA_CANCELLATION', key: 'rsOta' },
] as const;

/** Lập ngoại lệ bất khả kháng: lý do ≥ 20 ký tự (đếm theo ký tự) và minh chứng là mã tệp; API vẫn kiểm. */
export function CreateForm(props: {
  serverIssues: readonly FieldIssue[];
  busy: boolean;
  onCreate: (draft: CreateDraft) => void;
}): ReactElement {
  const [draft, setDraft] = useState<CreateDraft>(emptyCreate);
  const [local, setLocal] = useState<readonly FieldIssue[]>([]);
  const [asking, setAsking] = useState(false);
  const issues = [...local, ...props.serverIssues];
  const patch = (next: Partial<CreateDraft>) => {
    setLocal([]);
    setDraft({ ...draft, ...next });
  };
  return (
    <form
      style={box}
      aria-labelledby="hb138-create-title"
      onSubmit={(event) => {
        event.preventDefault();
        const found = createIssues(draft);
        setLocal(found);
        if (found.length === 0) setAsking(true);
      }}
    >
      <h2 id="hb138-create-title">{text('createTitle')}</h2>
      <p>{text('createNote')}</p>
      <TextInput
        name="bookingId"
        label={text('bookingId')}
        value={draft.bookingId}
        issues={issues}
        onChange={(value) => patch({ bookingId: value })}
      />
      <TextInput
        name="paymentId"
        label={text('paymentId')}
        value={draft.paymentId}
        issues={issues}
        onChange={(value) => patch({ paymentId: value })}
      />
      <SelectInput
        name="reasonCode"
        label={text('reasonCode')}
        value={draft.reason}
        options={REASONS.map((reason) => ({ id: reason.id, label: text(reason.key) }))}
        onChange={(value) =>
          patch({ reason: REASONS.find((reason) => reason.id === value)?.id ?? 'FORCE_MAJEURE' })
        }
      />
      <TextInput
        name="note"
        label={text('note')}
        value={draft.note}
        issues={issues}
        onChange={(value) => patch({ note: value })}
      />
      <p aria-live="polite">{text('noteCount', { count: charCount(draft.note) })}</p>
      <TextInput
        name="evidence"
        label={text('evidence')}
        value={draft.evidence}
        issues={issues}
        onChange={(value) => patch({ evidence: value })}
      />
      <button
        type="submit"
        disabled={props.busy}
        style={{ minHeight: 44, justifySelf: 'start' }}
        data-testid="hb138-create-submit"
      >
        {text('createGo')}
      </button>
      <ConfirmDialog
        id="hb138-dialog-create"
        open={asking}
        title={text('createTitle')}
        confirmLabel={text('confirm')}
        cancelLabel={text('cancel')}
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          props.onCreate(draft);
        }}
      >
        <p>{`${draft.bookingId.trim()} · ${draft.reason}`}</p>
      </ConfirmDialog>
    </form>
  );
}
