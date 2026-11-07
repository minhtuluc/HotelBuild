'use client';
import { useState, type ReactElement } from 'react';
import type { RoomTypeSummary } from '@pinehill/contracts';
import { ConfirmDialog, SelectInput, TextInput, box } from './parts';
import { text } from './messages';
import {
  closureIssues,
  emptyClosure,
  emptyMapping,
  mappingIssues,
  type ClosureDraft,
  type FieldIssue,
  type MappingDraft,
} from './model';

const submitStyle = { minHeight: 44, justifySelf: 'start' } as const;

function typeOptions(types: readonly RoomTypeSummary[]) {
  return types.map((type) => ({ id: type.id, label: type.code }));
}

/** Lỗi của máy chủ gắn theo trường khi lệnh bị từ chối; lỗi nhập cục bộ chỉ về hình dạng. */
export function MappingForm(props: {
  roomTypes: readonly RoomTypeSummary[];
  roomTypeId: string;
  serverIssues: readonly FieldIssue[];
  busy: boolean;
  onSubmit: (draft: MappingDraft) => void;
}): ReactElement {
  const [draft, setDraft] = useState<MappingDraft>(() => emptyMapping(props.roomTypeId));
  const [local, setLocal] = useState<readonly FieldIssue[]>([]);
  const [asking, setAsking] = useState(false);
  const roomTypeId = draft.roomTypeId === '' ? props.roomTypeId : draft.roomTypeId;
  const value = { ...draft, roomTypeId };
  const issues = [...local, ...props.serverIssues];
  const patch = (next: Partial<MappingDraft>) => {
    setLocal([]);
    setDraft({ ...value, ...next });
  };
  const check = () => {
    const found = mappingIssues(value);
    setLocal(found);
    if (found.length === 0) setAsking(true);
  };
  return (
    <form
      style={box}
      aria-labelledby="hb132-mapping-title"
      onSubmit={(event) => {
        event.preventDefault();
        check();
      }}
    >
      <h2 id="hb132-mapping-title">{text('mappingTitle')}</h2>
      <p>{text('mappingUnreadable')}</p>
      <SelectInput
        name="roomTypeId"
        label={text('roomType')}
        value={roomTypeId}
        options={typeOptions(props.roomTypes)}
        onChange={(id) => patch({ roomTypeId: id })}
        issues={issues}
      />
      <TextInput
        name="providerRoomTypeCode"
        label={text('providerCode')}
        value={draft.providerRoomTypeCode}
        issues={issues}
        onChange={(v) => patch({ providerRoomTypeCode: v })}
      />
      <TextInput
        name="allotmentPct"
        label={text('allotmentPct')}
        value={draft.allotmentPct}
        issues={issues}
        onChange={(v) => patch({ allotmentPct: v })}
      />
      <TextInput
        name="externalRatePlanCode"
        label={text('ratePlanCode')}
        value={draft.externalRatePlanCode}
        issues={issues}
        onChange={(v) => patch({ externalRatePlanCode: v })}
      />
      <SelectInput
        name="status"
        label={text('mappingStatus')}
        value={draft.status}
        options={[
          { id: 'ACTIVE', label: text('active') },
          { id: 'INACTIVE', label: text('inactive') },
        ]}
        onChange={(v) => patch({ status: v === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE' })}
      />
      <button
        type="submit"
        disabled={props.busy}
        style={submitStyle}
        data-testid="hb132-mapping-submit"
      >
        {text('saveMapping')}
      </button>
      <ConfirmDialog
        id="hb132-dialog-mapping"
        open={asking}
        title={text('mappingTitle')}
        confirmLabel={text('saveMapping')}
        cancelLabel={text('cancel')}
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          props.onSubmit(value);
        }}
      >
        <p>{`${value.providerRoomTypeCode.trim()} · ${value.allotmentPct.trim()}% · ${value.status}`}</p>
      </ConfirmDialog>
    </form>
  );
}

export function ClosureForm(props: {
  roomTypes: readonly RoomTypeSummary[];
  roomTypeId: string;
  date: string;
  serverIssues: readonly FieldIssue[];
  busy: boolean;
  onSubmit: (draft: ClosureDraft) => void;
}): ReactElement {
  const [draft, setDraft] = useState<ClosureDraft>(() =>
    emptyClosure(props.roomTypeId, props.date),
  );
  const [local, setLocal] = useState<readonly FieldIssue[]>([]);
  const [asking, setAsking] = useState(false);
  const roomTypeId = draft.roomTypeId === '' ? props.roomTypeId : draft.roomTypeId;
  const value = { ...draft, roomTypeId };
  const issues = [...local, ...props.serverIssues];
  const patch = (next: Partial<ClosureDraft>) => {
    setLocal([]);
    setDraft({ ...value, ...next });
  };
  return (
    <form
      style={box}
      aria-labelledby="hb132-closure-title"
      onSubmit={(event) => {
        event.preventDefault();
        const found = closureIssues(value);
        setLocal(found);
        if (found.length === 0) setAsking(true);
      }}
    >
      <h2 id="hb132-closure-title">{text('closureTitle')}</h2>
      <p>{text('closureRole')}</p>
      <SelectInput
        name="closureRoomTypeId"
        label={text('roomType')}
        value={roomTypeId}
        options={typeOptions(props.roomTypes)}
        onChange={(id) => patch({ roomTypeId: id })}
      />
      <TextInput
        name="from"
        type="date"
        label={text('from')}
        value={draft.from}
        issues={issues}
        onChange={(v) => patch({ from: v })}
      />
      <TextInput
        name="to"
        type="date"
        label={text('to')}
        value={draft.to}
        issues={issues}
        onChange={(v) => patch({ to: v })}
      />
      <TextInput
        name="reason"
        label={text('reason')}
        value={draft.reason}
        issues={issues}
        onChange={(v) => patch({ reason: v })}
      />
      <SelectInput
        name="closed"
        label={text('closureTitle')}
        value={draft.closed ? 'close' : 'open'}
        options={[
          { id: 'close', label: text('close') },
          { id: 'open', label: text('reopen') },
        ]}
        onChange={(v) => patch({ closed: v === 'close' })}
      />
      <button
        type="submit"
        disabled={props.busy}
        style={submitStyle}
        data-testid="hb132-closure-submit"
      >
        {text('submitClosure')}
      </button>
      <ConfirmDialog
        id="hb132-dialog-closure"
        open={asking}
        title={text('closureTitle')}
        confirmLabel={text('submitClosure')}
        cancelLabel={text('cancel')}
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          props.onSubmit(value);
        }}
      >
        <p>{`${value.from} → ${value.to} · ${value.closed ? text('close') : text('reopen')}`}</p>
      </ConfirmDialog>
    </form>
  );
}
