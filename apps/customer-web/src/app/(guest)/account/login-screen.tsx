'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { failureLines } from './account-copy';
import { browserDeps } from './account-deps';
import { runLogin } from './account-flows';
import { normalizePhone, safeNext, type AccountFailure, type Issues } from './account-model';
import {
  FormShell,
  Notice,
  SubmitButton,
  SummaryAlert,
  TextField,
  useFocusFirstIssue,
} from './form-parts';
import { accountText as text } from './messages';

type Field = 'phone' | 'password';
const ORDER: readonly Field[] = ['phone', 'password'];

export function LoginScreen({ contact }: { contact: string | null }): ReactElement {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [issues, setIssues] = useState<Issues<Field>>({});
  const [failure, setFailure] = useState<AccountFailure | null>(null);
  const [busy, setBusy] = useState(false);
  useFocusFirstIssue(issues, ORDER);
  const canonical = normalizePhone(phone);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const outcome = await runLogin({ phone, password }, browserDeps);
    setBusy(false);
    setIssues(outcome.kind === 'issues' ? outcome.issues : {});
    if (outcome.kind === 'failed') setFailure(outcome.failure);
    if (outcome.kind === 'done') router.replace(next);
  }

  return (
    <FormShell
      testId="login-screen"
      title={text('loginTitle')}
      intro={text('loginIntro')}
      onSubmit={(event) => void submit(event)}
    >
      {params.get('reset') === '1' ? (
        <Notice tone="success" testId="login-reset-notice" lines={[text('resetNotice')]} />
      ) : null}
      <SummaryAlert count={Object.keys(issues).length} />
      <TextField
        name="phone"
        label={text('phone')}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={phone}
        issue={issues.phone}
        hint={
          canonical !== null && canonical !== phone.trim()
            ? text('phoneCanonical', { phone: canonical })
            : text('phoneHint')
        }
        disabled={busy}
        onChange={setPhone}
      />
      <TextField
        name="password"
        label={text('password')}
        type="password"
        autoComplete="current-password"
        value={password}
        issue={issues.password}
        maxLength={128}
        disabled={busy}
        onChange={setPassword}
      />
      {failure === null ? null : (
        <Notice
          tone="error"
          testId="login-failure"
          lines={failureLines(failure, 'login', contact)}
        />
      )}
      <SubmitButton busy={busy} label={text('submitLogin')} testId="login-submit" />
      <a href="/account/forgot-password">{text('toForgot')}</a>
      <a href="/account/register">{text('toRegister')}</a>
    </FormShell>
  );
}
