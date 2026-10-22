'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { failureLines } from './account-copy';
import { browserDeps } from './account-deps';
import { runRegister } from './account-flows';
import {
  normalizePhone,
  safeNext,
  type AccountFailure,
  type Issues,
  type RegisterForm,
} from './account-model';
import {
  CheckField,
  FormShell,
  Notice,
  SubmitButton,
  SummaryAlert,
  TextField,
  useFocusFirstIssue,
} from './form-parts';
import { accountText as text } from './messages';

type Field = 'fullName' | 'phone' | 'email' | 'password';
const ORDER: readonly Field[] = ['fullName', 'phone', 'email', 'password'];
const EMPTY: RegisterForm = { fullName: '', phone: '', email: '', password: '', consent: false };

export function RegisterScreen({ contact }: { contact: string | null }): ReactElement {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const [form, setForm] = useState<RegisterForm>(EMPTY);
  const [issues, setIssues] = useState<Issues<Field>>({});
  const [failure, setFailure] = useState<AccountFailure | null>(null);
  const [notSignedIn, setNotSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  useFocusFirstIssue(issues, ORDER);
  const set = <K extends keyof RegisterForm>(key: K, value: RegisterForm[K]): void => {
    setForm((previous) => ({ ...previous, [key]: value }));
  };
  const canonical = normalizePhone(form.phone);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);
    setNotSignedIn(false);
    const outcome = await runRegister(form, browserDeps);
    setBusy(false);
    setIssues(outcome.kind === 'issues' ? outcome.issues : {});
    if (outcome.kind === 'failed') setFailure(outcome.failure);
    if (outcome.kind === 'createdNotSignedIn') setNotSignedIn(true);
    if (outcome.kind === 'done') router.replace(next);
  }

  return (
    <FormShell
      testId="register-screen"
      title={text('registerTitle')}
      intro={text('registerIntro')}
      onSubmit={(event) => void submit(event)}
    >
      <SummaryAlert count={Object.keys(issues).length} />
      <TextField
        name="fullName"
        label={text('fullName')}
        value={form.fullName}
        issue={issues.fullName}
        autoComplete="name"
        maxLength={120}
        disabled={busy}
        onChange={(v) => {
          set('fullName', v);
        }}
      />
      <TextField
        name="phone"
        label={text('phone')}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={form.phone}
        issue={issues.phone}
        hint={
          canonical !== null && canonical !== form.phone.trim()
            ? text('phoneCanonical', { phone: canonical })
            : text('phoneHint')
        }
        disabled={busy}
        onChange={(v) => {
          set('phone', v);
        }}
      />
      <TextField
        name="email"
        label={text('email')}
        type="email"
        inputMode="email"
        autoComplete="email"
        value={form.email}
        issue={issues.email}
        hint={text('emailHint')}
        maxLength={254}
        disabled={busy}
        onChange={(v) => {
          set('email', v);
        }}
      />
      <TextField
        name="password"
        label={text('password')}
        type="password"
        autoComplete="new-password"
        value={form.password}
        issue={issues.password}
        hint={text('passwordHint')}
        maxLength={128}
        disabled={busy}
        onChange={(v) => {
          set('password', v);
        }}
      />
      <CheckField
        name="consentMarketing"
        label={text('consent')}
        note={text('consentNote')}
        checked={form.consent}
        disabled={busy}
        onChange={(v) => {
          set('consent', v);
        }}
      />
      {failure === null ? null : (
        <Notice
          tone="error"
          testId="register-failure"
          lines={failureLines(failure, 'register', contact)}
        />
      )}
      {notSignedIn ? (
        <Notice tone="info" testId="register-created" lines={[text('registeredNotSignedIn')]}>
          <a href="/account/login">{text('loginLink')}</a>
        </Notice>
      ) : null}
      <SubmitButton busy={busy} label={text('submitRegister')} testId="register-submit" />
      <a href="/account/login">{text('toLogin')}</a>
    </FormShell>
  );
}
