'use client';
import type { FormEvent, ReactElement } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { space } from '@pinehill/ui-web';
import { ALERT_BANNER, AuthCard, PRIMARY, SECONDARY, TextField } from '../../../session/form-parts';
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
    <AuthCard
      titleId="change-title"
      title={text('changeTitle')}
      intro={me.mustChangePassword ? text('changeRequired') : text('changeIntro')}
      introTestId="change-intro"
    >
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
          <p role="alert" data-testid="change-summary" style={ALERT_BANNER}>
            {text('formInvalid', { count })}
          </p>
        )}
        <Fields form={form} />
        {failure === null || failure.kind === 'wrongCurrent' ? null : (
          <p role="alert" data-testid="change-failure" style={ALERT_BANNER}>
            {passwordFailureMessage(failure)}
          </p>
        )}
        <button
          type="submit"
          data-testid="change-submit"
          disabled={form.busy}
          className="ph-btn-primary"
          style={PRIMARY}
        >
          {form.busy ? text('changeSubmitting') : text('changeSubmit')}
        </button>
      </form>
      <button
        type="button"
        data-testid="change-logout"
        onClick={() => {
          void logout();
        }}
        className="ph-btn"
        style={SECONDARY}
      >
        {text('signOut')}
      </button>
    </AuthCard>
  );
}
