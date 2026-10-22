'use client';

import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { useSearchParams } from 'next/navigation';
import { failureLines } from './account-copy';
import { browserDeps } from './account-deps';
import { runReset } from './account-flows';
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

type Field = 'password' | 'confirm';
const ORDER: readonly Field[] = ['password', 'confirm'];

export function ResetScreen({ contact }: { contact: string | null }): ReactElement {
  const params = useSearchParams();
  // Token đọc một lần vào state: dọn thanh địa chỉ bên dưới không được làm mất nó.
  const [token] = useState(() => params.get('token') ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [issues, setIssues] = useState<Issues<'token' | Field>>({});
  const [failure, setFailure] = useState<AccountFailure | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  useFocusFirstIssue(issues, ORDER);

  // Token một lần không nên nằm lại trong thanh địa chỉ/lịch sử sau khi đã đọc vào bộ nhớ.
  useEffect(() => {
    if (token !== '') window.history.replaceState(null, '', window.location.pathname);
  }, [token]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const outcome = await runReset({ token, password, confirm }, browserDeps);
    setBusy(false);
    setIssues(outcome.kind === 'issues' ? outcome.issues : {});
    if (outcome.kind === 'failed') setFailure(outcome.failure);
    if (outcome.kind === 'done') {
      setDone(true);
      setPassword('');
      setConfirm('');
    }
  }

  if (done)
    return (
      <section data-testid="reset-done" style={{ display: 'grid', gap: 12 }}>
        <h1 style={{ margin: 0 }}>{text('resetTitle')}</h1>
        <Notice tone="success" testId="reset-done-notice" lines={[text('resetDone')]} />
        <a href="/account/login?reset=1">{text('toLoginAfterReset')}</a>
      </section>
    );

  return (
    <FormShell
      testId="reset-screen"
      title={text('resetTitle')}
      intro={text('resetIntro')}
      onSubmit={(event) => void submit(event)}
    >
      {token === '' ? (
        <Notice tone="error" testId="reset-missing-token" lines={[text('resetMissingToken')]} />
      ) : null}
      <SummaryAlert count={Object.keys(issues).filter((key) => key !== 'token').length} />
      <TextField
        name="password"
        label={text('newPassword')}
        type="password"
        autoComplete="new-password"
        value={password}
        issue={issues.password}
        hint={text('passwordHint')}
        maxLength={128}
        disabled={busy}
        onChange={setPassword}
      />
      <TextField
        name="confirm"
        label={text('confirmPassword')}
        type="password"
        autoComplete="new-password"
        value={confirm}
        issue={issues.confirm}
        maxLength={128}
        disabled={busy}
        onChange={setConfirm}
      />
      {failure === null ? null : (
        <Notice
          tone="error"
          testId="reset-failure"
          lines={failureLines(failure, 'reset', contact)}
        />
      )}
      <SubmitButton busy={busy} label={text('submitReset')} testId="reset-submit" />
      <a href="/account/forgot-password" data-testid="reset-new-link">
        {text('toNewLink')}
      </a>
    </FormShell>
  );
}
