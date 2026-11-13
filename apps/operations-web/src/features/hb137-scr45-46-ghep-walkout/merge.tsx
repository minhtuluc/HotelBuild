'use client';
import { useState, type ReactElement } from 'react';
import type { UserMe } from '@pinehill/contracts';
import type { Tagged } from './controller';
import { text } from './messages';
import {
  can,
  consentIssues,
  emptyMerge,
  mergeActionAllowed,
  mergeIssues,
  reasonIssues,
  type ConsentDraft,
  type FieldIssue,
  type MergeDraft,
} from './model';
import { ConfirmDialog, SelectInput, TextInput, box, remap } from './parts';
import type { RoomMergeView } from '@pinehill/contracts';

const SIDES = [
  { id: 'PRIMARY', key: 'sidePrimary' },
  { id: 'SECONDARY', key: 'sideSecondary' },
] as const;

function genderText(value: boolean | null): string {
  if (value === null) return text('genderNone');
  return value ? text('genderSame') : text('genderDiff');
}

function consentState(view: RoomMergeView, side: 'PRIMARY' | 'SECONDARY'): string {
  const found = view.consents.find((item) => item.side === side);
  if (found === undefined) return text('consentNone');
  const state = found.consented ? text('consentYes') : text('consentNo');
  return text('consentLine', {
    side,
    state,
    evidence: found.evidenceUrl ?? text('consentNone'),
    by: found.recordedBy,
  });
}

/** Hai bên xác nhận độc lập; CONNECTING không có đồng thuận. Mọi số liệu đọc từ máy chủ. */
function MergeSummary({ view }: { view: RoomMergeView }): ReactElement {
  const shared = view.moveType === 'MERGE_SHARE';
  const rooms = [view.roomId, view.roomIdA, view.roomIdB]
    .filter((item) => item !== null)
    .join(', ');
  return (
    <>
      <h2 id="hb137-merge-title">{text('mergeTitle', { id: view.id })}</h2>
      <p>{text('mergeType', { type: shared ? text('mergeShare') : text('mergeConnecting') })}</p>
      <p>
        {text('mergeBookings', {
          primary: view.primaryBookingId,
          secondary: view.secondaryBookingId === null ? '' : ` · ${view.secondaryBookingId}`,
        })}
      </p>
      <p>{text('mergeRooms', { rooms })}</p>
      <p data-testid="hb137-merge-status">{text('mergeStatus', { status: view.status })}</p>
      <p>{view.status === 'ACTIVE' ? text('mergeActive') : text('mergeNotActive')}</p>
      <p>{text('gender', { value: genderText(view.genderSame) })}</p>
      <p data-testid="hb137-discount">
        {text('discount', { pct: view.discountPct, amount: view.discountAmount })}
      </p>
      <p>
        {view.approvedBy === null ? text('notApproved') : text('approved', { by: view.approvedBy })}
      </p>
      <h3>{text('consentsTitle')}</h3>
      {shared ? (
        <ul>
          {SIDES.map((side) => (
            <li key={side.id}>{consentState(view, side.id)}</li>
          ))}
        </ul>
      ) : (
        <p>{text('consentNotApplicable')}</p>
      )}
      <p>{text('actions', { list: view.allowedActions.join(', ') || text('noActions') })}</p>
    </>
  );
}

function ConsentDialog(props: {
  open: boolean;
  serverIssues: readonly FieldIssue[];
  onCancel: () => void;
  onConfirm: (draft: ConsentDraft) => void;
}): ReactElement {
  const [draft, setDraft] = useState<ConsentDraft>({
    side: 'PRIMARY',
    consented: true,
    evidence: '',
  });
  const [local, setLocal] = useState<readonly FieldIssue[]>([]);
  const patch = (next: Partial<ConsentDraft>) => {
    setLocal([]);
    setDraft({ ...draft, ...next });
  };
  return (
    <ConfirmDialog
      id="hb137-dialog-consent"
      open={props.open}
      title={text('consentTitle')}
      confirmLabel={text('confirm')}
      cancelLabel={text('cancel')}
      onCancel={props.onCancel}
      onConfirm={() => {
        const found = consentIssues(draft);
        setLocal(found);
        if (found.length === 0) props.onConfirm(draft);
      }}
    >
      <SelectInput
        name="side"
        label={text('side')}
        value={draft.side}
        options={SIDES.map((side) => ({ id: side.id, label: text(side.key) }))}
        onChange={(value) => patch({ side: value === 'SECONDARY' ? 'SECONDARY' : 'PRIMARY' })}
      />
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
        <input
          type="checkbox"
          name="consented"
          checked={draft.consented}
          onChange={(event) => patch({ consented: event.target.checked })}
        />
        {text('consented')}
      </label>
      <TextInput
        name="consentEvidence"
        label={text('evidence')}
        value={draft.evidence}
        issues={remap([...local, ...props.serverIssues], { evidence: 'consentEvidence' })}
        onChange={(value) => patch({ evidence: value })}
      />
    </ConfirmDialog>
  );
}

function ReasonDialog(props: {
  open: boolean;
  serverIssues: readonly FieldIssue[];
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}): ReactElement {
  const [reason, setReason] = useState('');
  const [local, setLocal] = useState<readonly FieldIssue[]>([]);
  return (
    <ConfirmDialog
      id="hb137-dialog-merge-approve"
      open={props.open}
      title={text('approveTitle')}
      confirmLabel={text('confirm')}
      cancelLabel={text('cancel')}
      onCancel={props.onCancel}
      onConfirm={() => {
        const found = reasonIssues(reason);
        setLocal(found);
        if (found.length === 0) props.onConfirm(reason);
      }}
    >
      <TextInput
        name="reason"
        label={text('approveReason')}
        value={reason}
        issues={[...local, ...props.serverIssues]}
        onChange={(value) => {
          setLocal([]);
          setReason(value);
        }}
      />
    </ConfirmDialog>
  );
}

type Asking = 'consent' | 'approve' | 'execute' | null;

export function MergePanel(props: {
  merge: Tagged<RoomMergeView>;
  role: UserMe['role'];
  busy: boolean;
  serverIssues: readonly FieldIssue[];
  onConsent: (draft: ConsentDraft) => void;
  onApprove: (reason: string) => void;
  onExecute: () => void;
}): ReactElement {
  const [asking, setAsking] = useState<Asking>(null);
  const { view } = props.merge;
  const close = () => setAsking(null);
  const button = (
    action: 'RECORD_CONSENT' | 'APPROVE' | 'EXECUTE',
    target: Asking,
    label: string,
    id: string,
  ) =>
    mergeActionAllowed(props.role, action, view) ? (
      <button
        type="button"
        className="ph-btn-primary"
        disabled={props.busy}
        onClick={() => setAsking(target)}
        style={{ minHeight: 44 }}
        data-testid={id}
      >
        {label}
      </button>
    ) : null;
  return (
    <section
      className="ph-card"
      style={box}
      aria-labelledby="hb137-merge-title"
      data-testid="hb137-merge"
    >
      <MergeSummary view={view} />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {button('RECORD_CONSENT', 'consent', text('consentGo'), 'hb137-consent')}
        {button('APPROVE', 'approve', text('approveGo'), 'hb137-merge-approve')}
        {button('EXECUTE', 'execute', text('executeGo'), 'hb137-merge-execute')}
      </div>
      <ConsentDialog
        open={asking === 'consent'}
        serverIssues={props.serverIssues}
        onCancel={close}
        onConfirm={(draft) => {
          close();
          props.onConsent(draft);
        }}
      />
      <ReasonDialog
        open={asking === 'approve'}
        serverIssues={props.serverIssues}
        onCancel={close}
        onConfirm={(reason) => {
          close();
          props.onApprove(reason);
        }}
      />
      <ConfirmDialog
        id="hb137-dialog-merge-execute"
        open={asking === 'execute'}
        title={text('executeTitle')}
        confirmLabel={text('confirm')}
        cancelLabel={text('cancel')}
        onCancel={close}
        onConfirm={() => {
          close();
          props.onExecute();
        }}
      >
        <p>{text('mergeNotActive')}</p>
      </ConfirmDialog>
    </section>
  );
}

function fields(draft: MergeDraft): readonly { name: keyof MergeDraft; label: string }[] {
  return draft.moveType === 'MERGE_SHARE'
    ? [
        { name: 'primaryBookingId', label: text('primaryBooking') },
        { name: 'secondaryBookingId', label: text('secondaryBooking') },
        { name: 'roomId', label: text('roomId') },
      ]
    : [
        { name: 'bookingId', label: text('bookingId') },
        { name: 'roomIdA', label: text('roomA') },
        { name: 'roomIdB', label: text('roomB') },
      ];
}

/** Lập ghép (FRONT_DESK): chiết khấu do máy chủ áp theo chính sách, không có ô nhập. */
export function CreateMergeForm(props: {
  role: UserMe['role'];
  busy: boolean;
  serverIssues: readonly FieldIssue[];
  onCreate: (draft: MergeDraft) => void;
}): ReactElement | null {
  const [draft, setDraft] = useState<MergeDraft>(emptyMerge);
  const [local, setLocal] = useState<readonly FieldIssue[]>([]);
  const [asking, setAsking] = useState(false);
  if (!can(props.role, 'create')) return null;
  const patch = (next: Partial<MergeDraft>) => {
    setLocal([]);
    setDraft({ ...draft, ...next });
  };
  const issues = [...local, ...props.serverIssues];
  return (
    <form
      className="ph-card"
      style={box}
      aria-labelledby="hb137-create-title"
      onSubmit={(event) => {
        event.preventDefault();
        const found = mergeIssues(draft);
        setLocal(found);
        if (found.length === 0) setAsking(true);
      }}
    >
      <h2 id="hb137-create-title" style={{ margin: 0 }}>
        {text('createTitle')}
      </h2>
      <p style={{ margin: 0 }}>{text('createNote')}</p>
      <SelectInput
        name="moveType"
        label={text('createType')}
        value={draft.moveType}
        options={[
          { id: 'MERGE_SHARE', label: text('mergeShare') },
          { id: 'MERGE_CONNECTING', label: text('mergeConnecting') },
        ]}
        onChange={(value) =>
          patch({ moveType: value === 'MERGE_CONNECTING' ? 'MERGE_CONNECTING' : 'MERGE_SHARE' })
        }
      />
      {fields(draft).map((field) => (
        <TextInput
          key={field.name}
          name={field.name}
          label={field.label}
          value={draft[field.name]}
          issues={issues}
          onChange={(value) => patch({ [field.name]: value })}
        />
      ))}
      <button
        type="submit"
        className="ph-btn-primary"
        disabled={props.busy}
        style={{ minHeight: 44, justifySelf: 'start' }}
        data-testid="hb137-create-submit"
      >
        {text('createGo')}
      </button>
      <ConfirmDialog
        id="hb137-dialog-create"
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
        <p>{draft.moveType === 'MERGE_SHARE' ? text('mergeShare') : text('mergeConnecting')}</p>
      </ConfirmDialog>
    </form>
  );
}
