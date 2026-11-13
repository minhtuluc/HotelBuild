'use client';

/** Hộp thoại xác thực PIN 6 số dùng lại cho SCR-37/39/69. */
import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { color, fontFamily, radius, space, typography } from '@pinehill/ui-web';
import { t } from '../../../../../lib/i18n';
import type { PinIssue, PinStep } from './collect-model';

const FIELD_LABEL: CSSProperties = {
  display: 'grid',
  gap: 4,
  fontSize: 13,
  fontWeight: 500,
  color: color.text,
};

const ALERT_LINE: CSSProperties = {
  margin: 0,
  color: color.danger,
  fontSize: 13,
};

function PinHeader({
  title,
  description,
}: {
  title: string | undefined;
  description: string | undefined;
}): ReactElement {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <h2
        id="ops-collect-pin-title"
        style={{ margin: 0, fontFamily: fontFamily.sans, fontSize: typography.h2.web }}
      >
        {title ?? t('ops.collect.pin.title')}
      </h2>
      <p style={{ margin: 0, color: color.textMuted, fontSize: 14 }}>
        {description ?? t('ops.collect.pin.note')}
      </p>
    </div>
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
  autoOpen,
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
  /**
   * Mặc định mở ngay. `false` khi PIN là bước hai sau khi xem số máy chủ trả (UI-03, SCR-39/69):
   * hộp thoại modal mở ngay khi vào màn sẽ làm cả trang `inert`, chặn bước một (HB-219).
   */
  autoOpen?: boolean;
}): ReactElement {
  const dialog = useRef<HTMLDialogElement>(null);
  const initiallyOpen = autoOpen !== false;
  const [open, setOpen] = useState(initiallyOpen);
  // PIN đã dùng xong (verified → idle sau lệnh ghi): quay về trạng thái đầu, không bật lại modal đè kết quả.
  useEffect(() => {
    if (step === 'verified') setOpen(initiallyOpen);
  }, [step, initiallyOpen]);
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
      <p
        role="status"
        data-testid="pin-verified"
        style={{
          margin: 0,
          padding: `${space.s2}px ${space.s3}px`,
          background: '#E7F3EE',
          border: `1px solid ${color.border}`,
          boxShadow: `inset 0 0 0 1px ${color.success}`,
          borderRadius: radius.sm,
          color: color.success,
          fontSize: 14,
          fontWeight: 500,
        }}
      >
        {t('ops.collect.pin.verified')}
      </p>
    );
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.s2, alignItems: 'center' }}>
      <button
        type="button"
        data-testid="pin-open"
        className="ph-btn"
        disabled={busy}
        onClick={() => setOpen(true)}
      >
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
            width: 'min(420px, calc(100vw - 32px))',
            maxWidth: 'calc(100vw - 32px)',
            margin: 'auto',
            background: color.surface,
            color: color.text,
            border: `1px solid ${color.borderStrong}`,
            borderRadius: radius.sm,
            padding: space.s6,
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'grid', gap: space.s3 }}>
            <PinHeader title={title} description={description} />
            <label style={FIELD_LABEL}>
              {t('ops.collect.pin.label')}
              <input
                name="pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                value={pin}
                disabled={busy || step === 'locked'}
                style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '0.2em' }}
                onChange={(event) => {
                  onPin(event.target.value);
                }}
              />
            </label>
            {issue === null ? null : (
              <p role="alert" data-testid="pin-issue" style={ALERT_LINE}>
                {t('ops.collect.pin.issue.FORMAT')}
              </p>
            )}
            {!unavailable ? null : (
              <p role="alert" data-testid="pin-unavailable" style={ALERT_LINE}>
                {t('ops.collect.pin.unavailable')}
              </p>
            )}
            {!wrong ? null : (
              <p role="alert" data-testid="pin-wrong" style={ALERT_LINE}>
                {t('ops.collect.pin.wrong')}
              </p>
            )}
            {step !== 'locked' ? null : (
              <p role="alert" data-testid="pin-locked" style={ALERT_LINE}>
                {t('ops.collect.pin.locked', { minutes: lockedMinutes ?? 0 })}
              </p>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.s2, marginTop: space.s1 }}>
              <button
                type="button"
                data-testid="pin-submit"
                className="ph-btn-primary"
                disabled={busy || step === 'locked'}
                onClick={onSubmit}
              >
                {t('ops.collect.pin.submit')}
              </button>
              <button
                type="button"
                data-testid="pin-cancel"
                className="ph-btn"
                disabled={busy}
                onClick={close}
              >
                {t('ops.collect.pin.cancel')}
              </button>
            </div>
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
