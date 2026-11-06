'use client';
import { useState, type ReactElement } from 'react';
import type { BookingRelocationOptions } from '@pinehill/contracts';
import { text } from './messages';
import { emptyMoveDraft, moveIssues, type FieldIssue, type MoveDraft } from './model';
import { ConfirmDialog, SelectInput, TextInput, box } from './parts';

type Option = BookingRelocationOptions['options'][number];

function OptionRow({ option, index }: { option: Option; index: number }): ReactElement {
  return (
    <tr data-testid={`hb136-option-${index}`}>
      <th scope="row">{option.moveType}</th>
      <td>
        {option.feasible ? text('optFeasible') : text('unavailable', { note: option.note ?? '' })}
      </td>
      <td>{option.targetRoomId ?? option.targetPropertyId ?? text('noTarget')}</td>
      <td>{option.compensationAmount}</td>
      <td>{option.transportCost}</td>
      <td>{[text('priceLocked'), option.note].filter((item) => item !== undefined).join(' · ')}</td>
    </tr>
  );
}

/** Phương án chỉ của chính booking đang xử lý, số tiền nguyên từ máy chủ; không bảng xếp hạng. */
function OptionsTable({ options }: { options: BookingRelocationOptions }): ReactElement {
  return (
    <div
      role="region"
      aria-label={text('optionsTitle')}
      tabIndex={0}
      style={{ overflowX: 'auto', maxWidth: '100%' }}
    >
      <table data-testid="hb136-options">
        <thead>
          <tr>
            <th scope="col">{text('colType')}</th>
            <th scope="col">{text('optStatus')}</th>
            <th scope="col">{text('colTarget')}</th>
            <th scope="col">{text('colCompensation')}</th>
            <th scope="col">{text('colTransport')}</th>
            <th scope="col">{text('colNote')}</th>
          </tr>
        </thead>
        <tbody>
          {options.options.map((option, index) => (
            <OptionRow key={`${option.moveType}-${index}`} option={option} index={index} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CHANNELS = [
  { id: 'PHONE', key: 'phone' },
  { id: 'EMAIL', key: 'email' },
  { id: 'IN_PERSON', key: 'inPerson' },
  { id: 'SYSTEM', key: 'system' },
] as const;

function WalkOutFields(props: {
  draft: MoveDraft;
  issues: readonly FieldIssue[];
  patch: (next: Partial<MoveDraft>) => void;
}): ReactElement {
  return (
    <>
      <TextInput
        name="walkOutDocNo"
        label={text('walkOutDoc')}
        value={props.draft.walkOutDocNo}
        issues={props.issues}
        onChange={(value) => props.patch({ walkOutDocNo: value })}
      />
      <TextInput
        name="guestSignatureRef"
        label={text('guestSig')}
        value={props.draft.guestSignatureRef}
        issues={props.issues}
        onChange={(value) => props.patch({ guestSignatureRef: value })}
      />
      <TextInput
        name="staffSignatureRef"
        label={text('staffSig')}
        value={props.draft.staffSignatureRef}
        issues={props.issues}
        onChange={(value) => props.patch({ staffSignatureRef: value })}
      />
    </>
  );
}

function ConsentFields(props: {
  draft: MoveDraft;
  patch: (next: Partial<MoveDraft>) => void;
}): ReactElement {
  const { draft, patch } = props;
  return (
    <>
      <SelectInput
        name="channel"
        label={text('consentChannel')}
        value={draft.channel}
        options={CHANNELS.map((channel) => ({ id: channel.id, label: text(channel.key) }))}
        onChange={(value) =>
          patch({ channel: CHANNELS.find((channel) => channel.id === value)?.id ?? 'PHONE' })
        }
      />
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
        <input
          type="checkbox"
          name="granted"
          checked={draft.granted}
          onChange={(event) => patch({ granted: event.target.checked })}
        />
        {text('consentGranted')}
      </label>
    </>
  );
}

function submitBlocked(busy: boolean, bookingRoomId: string, feasibleCount: number): boolean {
  return busy || bookingRoomId === '' || feasibleCount === 0;
}

function RoomNotice({ bookingRoomId }: { bookingRoomId: string }): ReactElement | null {
  return bookingRoomId === '' ? <p role="alert">{text('needBookingRoom')}</p> : null;
}

function feasibleOptions(options: BookingRelocationOptions) {
  return options.options
    .map((option, index) => ({ option, index }))
    .filter((entry) => entry.option.feasible);
}

function DetailFields(props: {
  draft: MoveDraft;
  walkOut: boolean;
  issues: readonly FieldIssue[];
  patch: (next: Partial<MoveDraft>) => void;
}): ReactElement {
  return (
    <>
      <ConsentFields draft={props.draft} patch={props.patch} />
      {props.walkOut ? (
        <WalkOutFields draft={props.draft} issues={props.issues} patch={props.patch} />
      ) : null}
    </>
  );
}

export function OptionsPanel(props: {
  options: BookingRelocationOptions;
  bookingRoomId: string;
  serverIssues: readonly FieldIssue[];
  busy: boolean;
  onCreate: (draft: MoveDraft) => void;
}): ReactElement {
  const [draft, setDraft] = useState<MoveDraft>(emptyMoveDraft);
  const [local, setLocal] = useState<readonly FieldIssue[]>([]);
  const [asking, setAsking] = useState(false);
  const feasible = feasibleOptions(props.options);
  const chosen = props.options.options[draft.optionIndex];
  const issues = [...local, ...props.serverIssues];
  const patch = (next: Partial<MoveDraft>) => {
    setLocal([]);
    setDraft({ ...draft, ...next });
  };
  return (
    <section style={box} aria-labelledby="hb136-options-title" data-testid="hb136-options-panel">
      <h2 id="hb136-options-title">{text('optionsTitle')}</h2>
      <p>{text('optionsNote')}</p>
      <p>{text('impactBlocked')}</p>
      <OptionsTable options={props.options} />
      <RoomNotice bookingRoomId={props.bookingRoomId} />
      <form
        aria-labelledby="hb136-create-title"
        style={box}
        onSubmit={(event) => {
          event.preventDefault();
          const found = moveIssues(draft, chosen);
          setLocal(found);
          if (found.length === 0) setAsking(true);
        }}
      >
        <h3 id="hb136-create-title">{text('createTitle')}</h3>
        <SelectInput
          name="optionIndex"
          label={text('colType')}
          value={String(draft.optionIndex)}
          options={feasible.map((entry) => ({
            id: String(entry.index),
            label: entry.option.moveType,
          }))}
          onChange={(value) => patch({ optionIndex: Number(value) })}
        />
        <TextInput
          name="reason"
          label={text('reason')}
          value={draft.reason}
          issues={issues}
          onChange={(value) => patch({ reason: value })}
        />
        <DetailFields
          draft={draft}
          walkOut={chosen?.moveType === 'WALK_OUT'}
          issues={issues}
          patch={patch}
        />
        <button
          type="submit"
          disabled={submitBlocked(props.busy, props.bookingRoomId, feasible.length)}
          style={{ minHeight: 44, justifySelf: 'start' }}
          data-testid="hb136-create-submit"
        >
          {text('createGo')}
        </button>
        <ConfirmDialog
          id="hb136-dialog-create"
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
          <p>{`${chosen?.moveType ?? ''} · ${text('colCompensation')}: ${chosen?.compensationAmount ?? 0} · ${text('colTransport')}: ${chosen?.transportCost ?? 0}`}</p>
        </ConfirmDialog>
      </form>
    </section>
  );
}
