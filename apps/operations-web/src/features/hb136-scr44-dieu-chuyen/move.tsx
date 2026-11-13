'use client';
import { useState, type ReactElement } from 'react';
import type { UserMe } from '@pinehill/contracts';
import type { MoveState } from './controller';
import { text } from './messages';
import {
  actionAllowed,
  approveIssues,
  pinIssues,
  type ApproveDraft,
  type FieldIssue,
} from './model';
import { ConfirmDialog, TextInput, box } from './parts';

/**
 * Điều chuyển do máy chủ trả: trạng thái, phòng nguồn/đích, tiền nguyên, `allowedActions`. Chỉ `EXECUTED`
 * mới là hoàn tất; "giữ giá" luôn là cam kết của hợp đồng, không có khoản thu chênh lệch.
 */
function MoveSummary({ move }: { move: MoveState }): ReactElement {
  const { view } = move;
  return (
    <>
      <h2 id="hb136-move-title">{text('moveTitle', { id: view.id })}</h2>
      <p data-testid="hb136-move-status">{text('moveStatus', { status: view.status })}</p>
      <p>
        {text('moveRooms', {
          from: view.fromRoomId ?? text('noTarget'),
          to: view.toRoomId ?? text('noTarget'),
        })}
      </p>
      <p>{text('moveMoney', { comp: view.compensationAmount, transport: view.transportCost })}</p>
      <p>{text('priceLocked')}</p>
      <p>
        {view.approvedBy === null
          ? text('moveNotApproved')
          : text('moveApproved', { by: view.approvedBy })}
      </p>
      <p>{view.status === 'EXECUTED' ? text('moveDone') : text('moveNotDone')}</p>
      <p>{text('actions', { list: view.allowedActions.join(', ') || text('noActions') })}</p>
    </>
  );
}

/** Mỗi hộp thoại có ô PIN riêng (`name`/`id` duy nhất); lỗi `pin` được gắn vào đúng ô của hộp thoại đó. */
function PinField(props: {
  name: string;
  pin: string;
  issues: readonly FieldIssue[];
  onChange: (value: string) => void;
}): ReactElement {
  return (
    <>
      <p>{text('pinNote')}</p>
      <TextInput
        name={props.name}
        type="password"
        label={text('pin')}
        value={props.pin}
        issues={props.issues.map((item) =>
          item.field === 'pin' ? { ...item, field: props.name } : item,
        )}
        onChange={props.onChange}
      />
    </>
  );
}

function ApproveDialog(props: {
  move: MoveState;
  open: boolean;
  serverIssues: readonly FieldIssue[];
  onCancel: () => void;
  onConfirm: (draft: ApproveDraft, pin: string) => void;
}): ReactElement {
  const { view } = props.move;
  const [draft, setDraft] = useState<ApproveDraft>({
    compensationAmount: String(view.compensationAmount),
    transportCost: String(view.transportCost),
    note: '',
  });
  const [pin, setPin] = useState('');
  const [local, setLocal] = useState<readonly FieldIssue[]>([]);
  const patch = (next: Partial<ApproveDraft>) => {
    setLocal([]);
    setDraft({ ...draft, ...next });
  };
  const issues = [...local, ...props.serverIssues];
  return (
    <ConfirmDialog
      id="hb136-dialog-approve"
      open={props.open}
      title={text('approveTitle')}
      confirmLabel={text('confirm')}
      cancelLabel={text('cancel')}
      onCancel={props.onCancel}
      onConfirm={() => {
        const found = [...approveIssues(draft), ...pinIssues(pin)];
        setLocal(found);
        if (found.length > 0) return;
        props.onConfirm(draft, pin);
        setPin('');
      }}
    >
      <TextInput
        name="compensationAmount"
        label={text('compensation')}
        value={draft.compensationAmount}
        issues={issues}
        onChange={(value) => patch({ compensationAmount: value })}
      />
      <TextInput
        name="transportCost"
        label={text('transport')}
        value={draft.transportCost}
        issues={issues}
        onChange={(value) => patch({ transportCost: value })}
      />
      <TextInput
        name="note"
        label={text('approveNote')}
        value={draft.note}
        issues={issues}
        onChange={(value) => patch({ note: value })}
      />
      <PinField
        name="approvePin"
        pin={pin}
        issues={issues}
        onChange={(value) => {
          setLocal([]);
          setPin(value);
        }}
      />
    </ConfirmDialog>
  );
}

function ExecuteDialog(props: {
  open: boolean;
  serverIssues: readonly FieldIssue[];
  onCancel: () => void;
  onConfirm: (pin: string) => void;
}): ReactElement {
  const [pin, setPin] = useState('');
  const [local, setLocal] = useState<readonly FieldIssue[]>([]);
  return (
    <ConfirmDialog
      id="hb136-dialog-execute"
      open={props.open}
      title={text('executeTitle')}
      confirmLabel={text('confirm')}
      cancelLabel={text('cancel')}
      onCancel={props.onCancel}
      onConfirm={() => {
        const found = pinIssues(pin);
        setLocal(found);
        if (found.length > 0) return;
        props.onConfirm(pin);
        setPin('');
      }}
    >
      <PinField
        name="executePin"
        pin={pin}
        issues={[...local, ...props.serverIssues]}
        onChange={(value) => {
          setLocal([]);
          setPin(value);
        }}
      />
    </ConfirmDialog>
  );
}

export function MovePanel(props: {
  move: MoveState;
  role: UserMe['role'];
  busy: boolean;
  serverIssues: readonly FieldIssue[];
  onApprove: (draft: ApproveDraft, pin: string) => void;
  onExecute: (pin: string) => void;
}): ReactElement {
  const [asking, setAsking] = useState<'approve' | 'execute' | null>(null);
  const { view } = props.move;
  const close = () => setAsking(null);
  return (
    <section
      className="ph-card"
      style={box}
      aria-labelledby="hb136-move-title"
      data-testid="hb136-move"
    >
      <MoveSummary move={props.move} />
      <div className="ph-actions">
        {actionAllowed(props.role, 'APPROVE', view) ? (
          <button
            type="button"
            className="ph-btn-primary"
            disabled={props.busy}
            onClick={() => setAsking('approve')}
            style={{ minHeight: 44 }}
            data-testid="hb136-approve"
          >
            {text('approve')}
          </button>
        ) : null}
        {actionAllowed(props.role, 'EXECUTE', view) ? (
          <button
            type="button"
            className="ph-btn-primary"
            disabled={props.busy}
            onClick={() => setAsking('execute')}
            style={{ minHeight: 44 }}
            data-testid="hb136-execute"
          >
            {text('execute')}
          </button>
        ) : null}
      </div>
      <ApproveDialog
        move={props.move}
        open={asking === 'approve'}
        serverIssues={props.serverIssues}
        onCancel={close}
        onConfirm={(draft, pin) => {
          close();
          props.onApprove(draft, pin);
        }}
      />
      <ExecuteDialog
        open={asking === 'execute'}
        serverIssues={props.serverIssues}
        onCancel={close}
        onConfirm={(pin) => {
          close();
          props.onExecute(pin);
        }}
      />
    </section>
  );
}
