'use client';
import { useState, type FormEvent, type ReactElement } from 'react';
import { isApiError } from '@pinehill/api-client';
import { space } from '@pinehill/ui-web';
import { useOpsSession } from '../../../../lib/ops-session';
import { authText as text } from '../../../../session/messages';
import {
  EMPTY_PIN_FORM,
  pinFormIssue,
  setPinBody,
  type PinForm,
  type PinFormIssue,
} from './pin-model';

const ISSUE_TEXT: Readonly<Record<PinFormIssue, Parameters<typeof text>[0]>> = {
  PASSWORD: 'pinIssuePassword',
  PIN: 'pinIssuePin',
  CONFIRM: 'pinIssueConfirm',
};

type Outcome = { kind: 'idle' } | { kind: 'done' } | { kind: 'failed'; code: string };

function failureCode(error: unknown): string {
  return isApiError(error) && typeof error.code === 'string' ? error.code : 'E_NETWORK';
}

function Field(props: {
  id: string;
  label: string;
  value: string;
  type: 'password';
  inputMode?: 'numeric';
  maxLength: number;
  onChange: (value: string) => void;
}): ReactElement {
  return (
    <label htmlFor={props.id} style={{ display: 'grid', gap: space.s1 }}>
      <span>{props.label}</span>
      <input
        id={props.id}
        name={props.id}
        type={props.type}
        inputMode={props.inputMode}
        maxLength={props.maxLength}
        value={props.value}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
      />
    </label>
  );
}

export function PinScreen(): ReactElement {
  const session = useOpsSession('/auth/pin');
  const [form, setForm] = useState<PinForm>(EMPTY_PIN_FORM);
  const [issue, setIssue] = useState<PinFormIssue | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const set = (patch: Partial<PinForm>): void => {
    setForm((previous) => ({ ...previous, ...patch }));
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const found = pinFormIssue(form);
    setIssue(found);
    if (found !== null) return;
    setBusy(true);
    session.client
      .requestVoid({
        method: 'PUT',
        path: '/auth/pin',
        headers: { 'x-session-request': '1' },
        body: setPinBody(form),
        maxAttempts: 1,
      })
      .then(
        () => {
          setForm(EMPTY_PIN_FORM);
          setOutcome({ kind: 'done' });
        },
        (error: unknown) => {
          setOutcome({ kind: 'failed', code: failureCode(error) });
        },
      )
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <section className="ph-card" style={{ display: 'grid', gap: space.s3, padding: space.s4 }}>
      <h1 style={{ margin: 0 }}>{text('pinTitle')}</h1>
      <p style={{ margin: 0 }}>{text('pinIntro')}</p>
      <form noValidate onSubmit={submit} style={{ display: 'grid', gap: space.s3, maxWidth: 360 }}>
        <Field
          id="pin-current-password"
          label={text('currentPassword')}
          type="password"
          maxLength={128}
          value={form.currentPassword}
          onChange={(currentPassword) => {
            set({ currentPassword });
          }}
        />
        <Field
          id="pin-new"
          label={text('pinNew')}
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={form.pin}
          onChange={(pin) => {
            set({ pin });
          }}
        />
        <Field
          id="pin-confirm"
          label={text('pinConfirm')}
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={form.confirm}
          onChange={(confirm) => {
            set({ confirm });
          }}
        />
        {issue === null ? null : (
          <p role="alert" data-testid="pin-issue" style={{ margin: 0 }}>
            {text(ISSUE_TEXT[issue])}
          </p>
        )}
        {outcome.kind === 'done' ? (
          <p role="status" data-testid="pin-done" style={{ margin: 0 }}>
            {text('pinDone')}
          </p>
        ) : null}
        {outcome.kind === 'failed' ? (
          <p role="alert" data-testid="pin-failed" style={{ margin: 0 }}>
            {text('pinFailed')} ({outcome.code})
          </p>
        ) : null}
        <button type="submit" data-testid="pin-save" disabled={busy}>
          {text('pinSave')}
        </button>
      </form>
    </section>
  );
}
