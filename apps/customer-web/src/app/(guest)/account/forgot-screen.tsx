'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { failureLines } from './account-copy';
import { browserDeps } from './account-deps';
import { runForgot } from './account-flows';
import { type AccountFailure, type Issues } from './account-model';
import {
  FormShell,
  Notice,
  SubmitButton,
  SummaryAlert,
  TextField,
  useFocusFirstIssue,
} from './form-parts';
import { accountText as text } from './messages';

export function ForgotScreen({ contact }: { contact: string | null }): ReactElement {
  const [phone, setPhone] = useState('');
  const [issues, setIssues] = useState<Issues<'phone'>>({});
  const [failure, setFailure] = useState<AccountFailure | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  useFocusFirstIssue(issues, ['phone']);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);
    setSent(false);
    const outcome = await runForgot({ phone }, browserDeps);
    setBusy(false);
    setIssues(outcome.kind === 'issues' ? outcome.issues : {});
    if (outcome.kind === 'failed') setFailure(outcome.failure);
    if (outcome.kind === 'sent') setSent(true);
  }

  return (
    <FormShell
      testId="forgot-screen"
      title={text('forgotTitle')}
      intro={text('forgotIntro')}
      onSubmit={(event) => void submit(event)}
    >
      <SummaryAlert count={Object.keys(issues).length} />
      <TextField
        name="phone"
        label={text('phone')}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={phone}
        issue={issues.phone}
        hint={text('phoneHint')}
        disabled={busy}
        onChange={setPhone}
      />
      {failure === null ? null : (
        <Notice
          tone="error"
          testId="forgot-failure"
          lines={failureLines(failure, 'forgot', contact)}
        />
      )}
      {sent ? <Notice tone="success" testId="forgot-done" lines={[text('forgotDone')]} /> : null}
      <SubmitButton busy={busy} label={text('submitForgot')} testId="forgot-submit" />
      <p data-testid="forgot-no-email" style={{ margin: 0 }}>
        {text('forgotNoEmail')}{' '}
        {contact === null ? text('contactGeneric') : text('contactLine', { contact })}
      </p>
      <a href="/account/login">{text('toLogin')}</a>
    </FormShell>
  );
}
