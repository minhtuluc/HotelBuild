'use client';
import type { FormEvent, ReactElement } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { color, space } from '@pinehill/ui-web';
import { PAGE, PRIMARY, TextField } from '../../../session/form-parts';
import { authText as text } from '../../../session/messages';
import { safeNextPath } from '../../../session/next-path';
import { useStaffSession } from '../../../session/staff-session';
import { issueMessage, passwordFailureMessage } from '../../../session/view-text';
import { usePasswordChange, type PasswordChange } from './use-password-change';

function Fields({ form }: { form: PasswordChange }): ReactElement {
  const { values, issues, busy, refs, failure } = form;
  const wrongCurrent = failure?.kind === 'wrongCurrent' ? text('changeWrongCurrent') : undefined;
  return (
    <>
      <TextField
        id="change-current"
        label={text('currentPassword')}
        type="password"
        value={values.current}
        autoComplete="current-password"
        maxLength={128}
        disabled={busy}
        inputRef={refs.current}
        error={issues.current ? issueMessage('current', issues.current) : wrongCurrent}
        onChange={(value) => {
          form.set('current', value);
        }}
      />
      <TextField
        id="change-new"
        label={text('newPassword')}
        type="password"
        value={values.next}
        autoComplete="new-password"
        maxLength={128}
        disabled={busy}
        inputRef={refs.next}
        error={issues.next && issueMessage('next', issues.next)}
        onChange={(value) => {
          form.set('next', value);
        }}
      />
      <TextField
        id="change-confirm"
        label={text('confirmPassword')}
        type="password"
        value={values.confirm}
        autoComplete="new-password"
        maxLength={128}
        disabled={busy}
        inputRef={refs.confirm}
        error={issues.confirm && issueMessage('confirm', issues.confirm)}
        onChange={(value) => {
          form.set('confirm', value);
        }}
      />
    </>
  );
}

export function ChangePasswordForm(): ReactElement {
  const { me, changePassword, logout } = useStaffSession();
  const router = useRouter();
  const rawNext = useSearchParams().get('next');
  const form = usePasswordChange(changePassword, () => {
    router.replace(safeNextPath(rawNext));
  });
  const count = Object.keys(form.issues).length;
  const failure = form.failure;
  return (
    <section style={PAGE} aria-labelledby="change-title">
      <h1 id="change-title" style={{ margin: 0, fontSize: 24 }}>
        {text('changeTitle')}
      </h1>
      <p data-testid="change-intro" style={{ margin: 0, color: color.textMuted }}>
        {me.mustChangePassword ? text('changeRequired') : text('changeIntro')}
      </p>
      <form
        noValidate
        aria-busy={form.busy}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          form.submit();
        }}
        style={{ display: 'grid', gap: space.s4 }}
      >
        {count === 0 ? null : (
          <p role="alert" data-testid="change-summary" style={{ margin: 0, color: color.danger }}>
            {text('formInvalid', { count })}
          </p>
        )}
        <Fields form={form} />
        {failure === null || failure.kind === 'wrongCurrent' ? null : (
          <p role="alert" data-testid="change-failure" style={{ margin: 0, color: color.danger }}>
            {passwordFailureMessage(failure)}
          </p>
        )}
        <button type="submit" data-testid="change-submit" disabled={form.busy} style={PRIMARY}>
          {form.busy ? text('changeSubmitting') : text('changeSubmit')}
        </button>
      </form>
      <button
        type="button"
        data-testid="change-logout"
        onClick={() => {
          void logout();
        }}
        style={{ justifySelf: 'start', minHeight: 44 }}
      >
        {text('signOut')}
      </button>
    </section>
  );
}
