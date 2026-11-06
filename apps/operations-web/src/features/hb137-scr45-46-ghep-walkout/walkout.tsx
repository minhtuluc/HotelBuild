'use client';
import { useState, type ReactElement } from 'react';
import type { CompensationPaymentsView, RoomMoveView, UserMe } from '@pinehill/contracts';
import type { Tagged } from './controller';
import { text } from './messages';
import {
  approveIssues,
  canPayCompensation,
  moveActionAllowed,
  payIssues,
  pinIssues,
  type ApproveDraft,
  type FieldIssue,
  type PayDraft,
} from './model';
import { ConfirmDialog, SelectInput, TextInput, box, remap } from './parts';

function stage(view: RoomMoveView): string {
  if (view.status === 'EXECUTED') return text('walkExecuted');
  if (view.status === 'PROPOSED') return text('walkWaitApprove');
  return view.status === 'APPROVED' ? text('walkWaitExecute') : text('walkOther');
}

/** Hồ sơ walk-out đúng như máy chủ trả; "đã duyệt" không phải "đã chi", chỉ EXECUTED mới là đã thực hiện. */
function WalkSummary({ view }: { view: RoomMoveView }): ReactElement {
  const doc = view.walkOut;
  return (
    <>
      <h2 id="hb137-walk-title">{text('walkTitle', { id: view.id })}</h2>
      <p data-testid="hb137-walk-status">{text('walkStatus', { status: view.status })}</p>
      <p>{stage(view)}</p>
      <p>{text('walkMoney', { comp: view.compensationAmount, transport: view.transportCost })}</p>
      <p>
        {doc === null
          ? text('walkNoDoc')
          : text('walkDoc', {
              doc: doc.walkOutDocNo,
              guest: doc.guestSignatureRef,
              staff: doc.staffSignatureRef,
            })}
      </p>
      <p>{text('walkRefund', { id: doc?.refundRequestId ?? text('walkNoRefund') })}</p>
      <p>
        {view.approvedBy === null ? text('notApproved') : text('approved', { by: view.approvedBy })}
      </p>
      <p>{text('actions', { list: view.allowedActions.join(', ') || text('noActions') })}</p>
      <p>{text('previewBlocked')}</p>
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
  const own = props.issues.map((item) =>
    item.field === 'pin' ? { ...item, field: props.name } : item,
  );
  return (
    <>
      <p>{text('pinNote')}</p>
      <TextInput
        name={props.name}
        type="password"
        label={text('pin')}
        value={props.pin}
        issues={own}
        onChange={props.onChange}
      />
    </>
  );
}

function ApproveDialog(props: {
  view: RoomMoveView;
  open: boolean;
  serverIssues: readonly FieldIssue[];
  onCancel: () => void;
  onConfirm: (draft: ApproveDraft, pin: string) => void;
}): ReactElement {
  const [draft, setDraft] = useState<ApproveDraft>({
    compensationAmount: String(props.view.compensationAmount),
    transportCost: String(props.view.transportCost),
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
      id="hb137-dialog-move-approve"
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
        label={text('approveComp')}
        value={draft.compensationAmount}
        issues={issues}
        onChange={(value) => patch({ compensationAmount: value })}
      />
      <TextInput
        name="transportCost"
        label={text('approveTransport')}
        value={draft.transportCost}
        issues={issues}
        onChange={(value) => patch({ transportCost: value })}
      />
      <TextInput
        name="approveNote"
        label={text('approveNote')}
        value={draft.note}
        issues={remap(issues, { note: 'approveNote' })}
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

function PinOnlyDialog(props: {
  id: string;
  title: string;
  pinName: string;
  open: boolean;
  serverIssues: readonly FieldIssue[];
  onCancel: () => void;
  onConfirm: (pin: string) => void;
}): ReactElement {
  const [pin, setPin] = useState('');
  const [local, setLocal] = useState<readonly FieldIssue[]>([]);
  return (
    <ConfirmDialog
      id={props.id}
      open={props.open}
      title={props.title}
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
        name={props.pinName}
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

export function WalkOutPanel(props: {
  move: Tagged<RoomMoveView>;
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
    <section style={box} aria-labelledby="hb137-walk-title" data-testid="hb137-walk">
      <WalkSummary view={view} />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {moveActionAllowed(props.role, 'APPROVE', view) ? (
          <button
            type="button"
            disabled={props.busy}
            onClick={() => setAsking('approve')}
            style={{ minHeight: 44 }}
            data-testid="hb137-move-approve"
          >
            {text('approveGo')}
          </button>
        ) : null}
        {moveActionAllowed(props.role, 'EXECUTE', view) ? (
          <button
            type="button"
            disabled={props.busy}
            onClick={() => setAsking('execute')}
            style={{ minHeight: 44 }}
            data-testid="hb137-move-execute"
          >
            {text('executeGo')}
          </button>
        ) : null}
      </div>
      <ApproveDialog
        view={view}
        open={asking === 'approve'}
        serverIssues={props.serverIssues}
        onCancel={close}
        onConfirm={(draft, pin) => {
          close();
          props.onApprove(draft, pin);
        }}
      />
      <PinOnlyDialog
        id="hb137-dialog-move-execute"
        title={text('executeTitle')}
        pinName="executePin"
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

function PaymentLines({ view }: { view: CompensationPaymentsView }): ReactElement {
  if (view.payments.length === 0) return <p>{text('payNone')}</p>;
  return (
    <ul>
      {view.payments.map((item) => (
        <li key={item.id} data-testid={`hb137-payment-${item.id}`}>
          {text('payLine', {
            id: item.id,
            state: item.state,
            amount: item.amount,
            method: item.method,
          })}
          {item.state === 'UNKNOWN' ? ` ${text('payUnknown', { op: item.operationId })}` : ''}
        </li>
      ))}
    </ul>
  );
}

function PayDialog(props: {
  open: boolean;
  serverIssues: readonly FieldIssue[];
  onCancel: () => void;
  onConfirm: (draft: PayDraft, pin: string) => void;
}): ReactElement {
  const [draft, setDraft] = useState<PayDraft>({
    method: 'CASH',
    bankReference: '',
    note: '',
    evidence: '',
  });
  const [pin, setPin] = useState('');
  const [local, setLocal] = useState<readonly FieldIssue[]>([]);
  const patch = (next: Partial<PayDraft>) => {
    setLocal([]);
    setDraft({ ...draft, ...next });
  };
  const issues = [...local, ...props.serverIssues];
  return (
    <ConfirmDialog
      id="hb137-dialog-pay"
      open={props.open}
      title={text('payTitle')}
      confirmLabel={text('confirm')}
      cancelLabel={text('cancel')}
      onCancel={props.onCancel}
      onConfirm={() => {
        const found = [...payIssues(draft), ...pinIssues(pin)];
        setLocal(found);
        if (found.length > 0) return;
        props.onConfirm(draft, pin);
        setPin('');
      }}
    >
      <SelectInput
        name="payMethod"
        label={text('payMethod')}
        value={draft.method}
        options={[
          { id: 'CASH', label: text('cash') },
          { id: 'BANK_TRANSFER', label: text('transfer') },
        ]}
        onChange={(value) =>
          patch({ method: value === 'BANK_TRANSFER' ? 'BANK_TRANSFER' : 'CASH' })
        }
      />
      <TextInput
        name="payBankReference"
        label={text('bankReference')}
        value={draft.bankReference}
        issues={remap(issues, { bankReference: 'payBankReference' })}
        onChange={(value) => patch({ bankReference: value })}
      />
      <TextInput
        name="payEvidence"
        label={text('payEvidence')}
        value={draft.evidence}
        issues={remap(issues, { evidence: 'payEvidence' })}
        onChange={(value) => patch({ evidence: value })}
      />
      <TextInput
        name="payNote"
        label={text('payNoteLabel')}
        value={draft.note}
        issues={remap(issues, { note: 'payNote' })}
        onChange={(value) => patch({ note: value })}
      />
      <PinField
        name="payPin"
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

/** Chi bồi thường là bước riêng của ACCOUNTANT; số tiền lấy từ điều chuyển đã duyệt, không nhập lại. */
export function CompensationPanel(props: {
  move: Tagged<RoomMoveView>;
  payments: CompensationPaymentsView | null;
  role: UserMe['role'];
  busy: boolean;
  serverIssues: readonly FieldIssue[];
  onPay: (draft: PayDraft, pin: string) => void;
}): ReactElement | null {
  const [asking, setAsking] = useState(false);
  if (props.payments === null) return null;
  const allowed = canPayCompensation(props.role, props.move.view, props.payments.payments);
  return (
    <section style={box} aria-labelledby="hb137-pay-title" data-testid="hb137-pay">
      <h2 id="hb137-pay-title">{text('payTitle')}</h2>
      <p>{text('payApproved', { amount: props.payments.approvedAmount })}</p>
      <PaymentLines view={props.payments} />
      <p>{text('payRole')}</p>
      {allowed ? (
        <button
          type="button"
          disabled={props.busy}
          onClick={() => setAsking(true)}
          style={{ minHeight: 44, justifySelf: 'start' }}
          data-testid="hb137-pay-submit"
        >
          {text('payGo')}
        </button>
      ) : null}
      <PayDialog
        open={asking}
        serverIssues={props.serverIssues}
        onCancel={() => setAsking(false)}
        onConfirm={(draft, pin) => {
          setAsking(false);
          props.onPay(draft, pin);
        }}
      />
    </section>
  );
}
