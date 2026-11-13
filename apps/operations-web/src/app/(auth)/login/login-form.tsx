'use client';
import { useRef, type FormEvent, type ReactElement } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { space } from '@pinehill/ui-web';
import { FIELD_IDS, useLoginFlow } from './use-login-flow';
import {
  ALERT_BANNER,
  AuthCard,
  PRIMARY,
  TextField,
  WARN_BANNER,
} from '../../../session/form-parts';
import { authText as text } from '../../../session/messages';
import { issueMessage, loginFailureMessage } from '../../../session/view-text';

export function LoginForm(): ReactElement {
  const params = useSearchParams();
  const router = useRouter();
  const flow = useLoginFlow(params.get('next'), (target) => {
    router.replace(target);
  });
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const issueCount = Object.keys(flow.issues).length;
  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    const found = flow.submit();
    // Tiêu điểm về trường lỗi đầu tiên (§8.1).
    if (found.username !== undefined) usernameRef.current?.focus();
    else if (found.password !== undefined) passwordRef.current?.focus();
  };
  return (
    <AuthCard titleId="login-title" title={text('loginTitle')} intro={text('loginIntro')}>
      {params.get('reason') === 'expired' ? (
        <p role="status" data-testid="login-expired" style={WARN_BANNER}>
          {text('expired')}
        </p>
      ) : null}
      <form
        noValidate
        onSubmit={onSubmit}
        aria-busy={flow.busy}
        style={{ display: 'grid', gap: space.s4 }}
      >
        {issueCount === 0 ? null : (
          <p role="alert" data-testid="login-summary" style={ALERT_BANNER}>
            {text('formInvalid', { count: issueCount })}
          </p>
        )}
        <TextField
          id={FIELD_IDS.username}
          label={text('username')}
          value={flow.username}
          autoComplete="username"
          maxLength={64}
          disabled={flow.busy}
          inputRef={usernameRef}
          error={flow.issues.username && issueMessage('username', flow.issues.username)}
          onChange={flow.setUsername}
        />
        <TextField
          id={FIELD_IDS.password}
          label={text('password')}
          type="password"
          value={flow.password}
          autoComplete="current-password"
          maxLength={128}
          disabled={flow.busy}
          inputRef={passwordRef}
          error={flow.issues.password && issueMessage('password', flow.issues.password)}
          onChange={flow.setPassword}
        />
        {flow.failure === null ? null : (
          <p role="alert" data-testid="login-failure" style={ALERT_BANNER}>
            {loginFailureMessage(flow.failure)}
          </p>
        )}
        <button
          type="submit"
          data-testid="login-submit"
          disabled={flow.busy}
          className="ph-btn-primary"
          style={PRIMARY}
        >
          {flow.busy ? text('signingIn') : text('signIn')}
        </button>
      </form>
    </AuthCard>
  );
}
