'use client';

/** Phần trình bày SCR-37 (HB-109): hộp thoại PIN, biểu mẫu thu tiền, biên lai. */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { formatDateTimeVn, formatMoney } from '@pinehill/ui-web';
import type { Payment } from '@pinehill/contracts';
import { t } from '../../../../../lib/i18n';
import {
  COLLECT_METHODS,
  COLLECT_METHOD_KEYS,
  COLLECT_TYPES,
  COLLECT_TYPE_KEYS,
  receiptLines,
  type AmountIssue,
  type CollectMethod,
  type CollectType,
  type PinIssue,
  type PinStep,
} from './collect-model';

const CELL = { padding: '4px 12px 4px 0', textAlign: 'left' } as const;

function PinHeader({
  title,
  description,
}: {
  title: string | undefined;
  description: string | undefined;
}): ReactElement {
  return (
    <>
      <h2 id="ops-collect-pin-title" style={{ margin: 0 }}>
        {title ?? t('ops.collect.pin.title')}
      </h2>
      <p style={{ margin: 0 }}>{description ?? t('ops.collect.pin.note')}</p>
    </>
  );
}

export function PinDialog({
  step,
  pin,
  issue,
  lockedMinutes,
  wrong,
  unavailable,
  busy,
  onPin,
  onSubmit,
  title,
  description,
}: {
  step: PinStep;
  pin: string;
  issue: PinIssue | null;
  lockedMinutes: number | null;
  wrong: boolean;
  unavailable: boolean;
  busy: boolean;
  onPin: (value: string) => void;
  onSubmit: () => void;
  title?: string;
  description?: string;
}): ReactElement {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const element = dialog.current;
    if (element === null || !open || step === 'verified') return;
    element.showModal();
    return () => element.close();
  }, [open, step]);
  const close = () => {
    if (busy) return;
    onPin('');
    setOpen(false);
  };
  if (step === 'verified')
    return (
      <p role="status" data-testid="pin-verified" style={{ margin: 0 }}>
        {t('ops.collect.pin.verified')}
      </p>
    );
  return (
    <>
      <button type="button" data-testid="pin-open" disabled={busy} onClick={() => setOpen(true)}>
        {t('ops.collect.pin.open')}
      </button>
      {open ? (
        <dialog
          ref={dialog}
          aria-labelledby="ops-collect-pin-title"
          data-testid="pin-dialog"
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Tab') return;
            const controls = [
              ...event.currentTarget.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
                'input:not(:disabled), button:not(:disabled)',
              ),
            ];
            const first = controls[0];
            const last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }}
          style={{
            maxWidth: 'calc(100vw - 32px)',
            margin: 'auto',
            border: '1px solid var(--color-border)',
            padding: 16,
          }}
        >
          <div style={{ display: 'grid', gap: 8 }}>
            <PinHeader title={title} description={description} />
            <>
              <label style={{ display: 'grid', gap: 4 }}>
                {t('ops.collect.pin.label')}
                <input
                  name="pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={6}
                  value={pin}
                  disabled={busy || step === 'locked'}
                  onChange={(event) => {
                    onPin(event.target.value);
                  }}
                />
              </label>
              {issue === null ? null : (
                <p role="alert" data-testid="pin-issue" style={{ margin: 0 }}>
                  {t('ops.collect.pin.issue.FORMAT')}
                </p>
              )}
              {!unavailable ? null : (
                <p role="alert" data-testid="pin-unavailable">
                  {t('ops.collect.pin.unavailable')}
                </p>
              )}
              {!wrong ? null : (
                <p role="alert" data-testid="pin-wrong" style={{ margin: 0 }}>
                  {t('ops.collect.pin.wrong')}
                </p>
              )}
              {step !== 'locked' ? null : (
                <p role="alert" data-testid="pin-locked" style={{ margin: 0 }}>
                  {t('ops.collect.pin.locked', { minutes: lockedMinutes ?? 0 })}
                </p>
              )}
              <button
                type="button"
                data-testid="pin-submit"
                disabled={busy || step === 'locked'}
                onClick={onSubmit}
              >
                {t('ops.collect.pin.submit')}
              </button>
            </>
            <button type="button" data-testid="pin-cancel" disabled={busy} onClick={close}>
              {t('ops.collect.pin.cancel')}
            </button>
          </div>
        </dialog>
      ) : null}
    </>
  );
}

export function CollectForm({
  type,
  method,
  amount,
  suggested,
  note,
  issue,
  pinReady,
  busy,
  onType,
  onMethod,
  onAmount,
  onNote,
  onSend,
}: {
  type: CollectType;
  method: CollectMethod;
  amount: string;
  suggested: number;
  note: string;
  issue: AmountIssue | null;
  pinReady: boolean;
  busy: boolean;
  onType: (value: CollectType) => void;
  onMethod: (value: CollectMethod) => void;
  onAmount: (value: string) => void;
  onNote: (value: string) => void;
  onSend: () => void;
}): ReactElement {
  const issueKey =
    issue === 'FORMAT'
      ? 'ops.collect.issue.FORMAT'
      : issue === 'POSITIVE'
        ? 'ops.collect.issue.POSITIVE'
        : 'ops.collect.issue.OVER';
  return (
    <div data-testid="collect-form" style={{ display: 'grid', gap: 8, maxWidth: 520 }}>
      <label style={{ display: 'grid', gap: 4 }}>
        {t('ops.collect.type')}
        <select
          name="type"
          value={type}
          disabled={busy}
          onChange={(event) => {
            const value = COLLECT_TYPES.find((item) => item === event.target.value);
            if (value !== undefined) onType(value);
          }}
        >
          {COLLECT_TYPES.map((item) => (
            <option key={item} value={item}>
              {t(COLLECT_TYPE_KEYS[item])}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: 'grid', gap: 4 }}>
        {t('ops.collect.method')}
        <select
          name="method"
          value={method}
          disabled={busy}
          onChange={(event) => {
            const value = COLLECT_METHODS.find((item) => item === event.target.value);
            if (value !== undefined) onMethod(value);
          }}
        >
          {COLLECT_METHODS.map((item) => (
            <option key={item} value={item}>
              {t(COLLECT_METHOD_KEYS[item])}
            </option>
          ))}
        </select>
      </label>
      <p style={{ margin: 0 }} data-testid="collect-suggested">
        {t('ops.collect.suggested', { amount: formatMoney(suggested) })}
      </p>
      <label style={{ display: 'grid', gap: 4 }}>
        {t('ops.collect.amount')}
        <input
          name="amount"
          inputMode="numeric"
          value={amount}
          disabled={busy}
          onChange={(event) => {
            onAmount(event.target.value);
          }}
        />
      </label>
      {issue === null ? null : (
        <p role="alert" data-testid="collect-issue" style={{ margin: 0 }}>
          {t(issueKey)}
        </p>
      )}
      <label style={{ display: 'grid', gap: 4 }}>
        {t('ops.collect.note')}
        <input
          name="note"
          maxLength={500}
          value={note}
          disabled={busy}
          onChange={(event) => {
            onNote(event.target.value);
          }}
        />
      </label>
      {pinReady ? null : (
        <p role="status" data-testid="pin-required" style={{ margin: 0 }}>
          {t('ops.collect.pin.required')}
        </p>
      )}
      <p style={{ margin: 0 }}>{t('ops.collect.noCard')}</p>
      <button
        type="button"
        data-testid="collect-send"
        disabled={busy || !pinReady}
        onClick={onSend}
      >
        {t('ops.collect.send')}
      </button>
    </div>
  );
}

export function Receipt({
  payment,
  onPrint,
}: {
  payment: Payment;
  onPrint: () => void;
}): ReactElement {
  return (
    <section
      data-testid="collect-receipt"
      aria-labelledby="ops-collect-receipt-title"
      style={{ display: 'grid', gap: 8 }}
    >
      <h2 id="ops-collect-receipt-title" style={{ margin: 0 }}>
        {t('ops.collect.receipt.title')}
      </h2>
      <table>
        <tbody>
          {receiptLines(payment).map((line) => (
            <tr key={line.key}>
              <th scope="row" style={CELL}>
                {t(line.key)}
              </th>
              <td style={CELL}>{line.value}</td>
            </tr>
          ))}
          <tr>
            <th scope="row" style={CELL}>
              {t('ops.collect.receipt.paidAt')}
            </th>
            <td style={CELL}>{payment.paidAt === null ? '—' : formatDateTimeVn(payment.paidAt)}</td>
          </tr>
        </tbody>
      </table>
      <button type="button" data-testid="collect-print" onClick={onPrint}>
        {t('ops.collect.print')}
      </button>
    </section>
  );
}
