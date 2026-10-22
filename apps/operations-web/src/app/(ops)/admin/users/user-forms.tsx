'use client';
import { useState, type ReactElement } from 'react';
import type { UserRole, UserSummary } from '@pinehill/contracts';
import { typography } from '@pinehill/ui-web';
import type { PropertyOption } from './controller';
import { RoleSelect } from './role-select';
import { ScopePicker } from './scope-picker';
import { CONTROL, FIELD, PANEL } from './styles';
import {
  accessChanged,
  accessDraft,
  assignableRoles,
  type AccessDraft,
  type CreateDraft,
  type FieldIssue,
  type WriteFailure,
} from './users-model';
import { userText, type UserMessageKey } from './messages';
import { WriteNotice } from './write-notice';

interface FormProps {
  properties: readonly PropertyOption[] | null;
  busy: boolean;
  failure: WriteFailure | null;
  onCancel: () => void;
  onReload: () => void;
}

const FIELD_LABEL: Record<FieldIssue['field'], UserMessageKey> = {
  username: 'username',
  fullName: 'fullName',
  phone: 'phone',
  propertyScope: 'scope',
};

const heading = { margin: 0, fontSize: typography.h2.web } as const;

function IssueList({ issues }: { issues: readonly FieldIssue[] }): ReactElement | null {
  if (issues.length === 0) return null;
  return (
    <ul role="alert" data-testid="form-issues" style={{ margin: 0, paddingLeft: 20 }}>
      {issues.map((item) => (
        <li key={item.field}>
          {userText('fieldIssue', {
            field: userText(FIELD_LABEL[item.field]),
            issue: userText(`issue${item.issue}` satisfies UserMessageKey),
          })}
        </li>
      ))}
    </ul>
  );
}

function Actions({
  busy,
  label,
  disabled = false,
  onCancel,
}: {
  busy: boolean;
  label: string;
  disabled?: boolean;
  onCancel: () => void;
}): ReactElement {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <button type="submit" data-testid="form-submit" style={CONTROL} disabled={busy || disabled}>
        {busy ? userText('submitting') : label}
      </button>
      <button
        type="button"
        data-testid="form-cancel"
        style={CONTROL}
        disabled={busy}
        onClick={onCancel}
      >
        {userText('cancel')}
      </button>
    </div>
  );
}

function TextField({
  name,
  label,
  value,
  invalid,
  disabled,
  maxLength,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  invalid: boolean;
  disabled: boolean;
  maxLength: number;
  onChange: (value: string) => void;
}): ReactElement {
  return (
    <label style={FIELD}>
      {label}
      <input
        name={name}
        style={CONTROL}
        value={value}
        maxLength={maxLength}
        disabled={disabled}
        aria-invalid={invalid}
        autoComplete="off"
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </label>
  );
}

export function CreateForm({
  actorRole,
  issues,
  onSubmit,
  ...rest
}: FormProps & {
  actorRole: UserRole;
  issues: readonly FieldIssue[];
  onSubmit: (draft: CreateDraft) => void;
}): ReactElement {
  const roles = assignableRoles(actorRole);
  const [draft, setDraft] = useState<CreateDraft>({
    username: '',
    fullName: '',
    phone: '',
    role: roles.includes('FRONT_DESK') ? 'FRONT_DESK' : (roles[0] ?? 'FRONT_DESK'),
    propertyScope: [],
  });
  const patch = (next: Partial<CreateDraft>): void => {
    setDraft((previous) => ({ ...previous, ...next }));
  };
  const invalid = (field: FieldIssue['field']): boolean =>
    issues.some((item) => item.field === field);
  return (
    <form
      aria-labelledby="create-title"
      data-testid="create-form"
      style={PANEL}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(draft);
      }}
    >
      <h2 id="create-title" style={heading}>
        {userText('createTitle')}
      </h2>
      <TextField
        name="username"
        label={userText('username')}
        value={draft.username}
        maxLength={64}
        invalid={invalid('username')}
        disabled={rest.busy}
        onChange={(username) => {
          patch({ username });
        }}
      />
      <TextField
        name="fullName"
        label={userText('fullName')}
        value={draft.fullName}
        maxLength={120}
        invalid={invalid('fullName')}
        disabled={rest.busy}
        onChange={(fullName) => {
          patch({ fullName });
        }}
      />
      <TextField
        name="phone"
        label={userText('phone')}
        value={draft.phone}
        maxLength={16}
        invalid={invalid('phone')}
        disabled={rest.busy}
        onChange={(phone) => {
          patch({ phone });
        }}
      />
      <RoleSelect
        roles={roles}
        value={draft.role}
        disabled={rest.busy}
        onChange={(role) => {
          patch({ role });
        }}
      />
      <ScopePicker
        options={rest.properties}
        value={draft.propertyScope}
        disabled={rest.busy}
        onChange={(propertyScope) => {
          patch({ propertyScope });
        }}
      />
      <p style={{ margin: 0 }}>{userText('tempPasswordNote')}</p>
      <IssueList issues={issues} />
      {rest.failure === null ? null : (
        <WriteNotice failure={rest.failure} attemptedVersion="—" onReload={rest.onReload} />
      )}
      <Actions busy={rest.busy} label={userText('submitCreate')} onCancel={rest.onCancel} />
    </form>
  );
}

export function AccessEditor({
  user,
  actorRole,
  onSave,
  ...rest
}: FormProps & {
  user: UserSummary;
  actorRole: UserRole;
  onSave: (draft: AccessDraft) => void;
}): ReactElement {
  const [draft, setDraft] = useState<AccessDraft>(() => accessDraft(user));
  const changed = accessChanged(user, draft);
  return (
    <form
      aria-labelledby="access-title"
      data-testid="access-form"
      style={PANEL}
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
    >
      <h2 id="access-title" style={heading}>
        {userText('accessTitle', { name: user.fullName })}
      </h2>
      <RoleSelect
        roles={assignableRoles(actorRole)}
        value={draft.role}
        keep={user.role}
        disabled={rest.busy}
        onChange={(role) => {
          setDraft((d) => ({ ...d, role }));
        }}
      />
      <ScopePicker
        options={rest.properties}
        value={draft.propertyScope}
        disabled={rest.busy}
        onChange={(propertyScope) => {
          setDraft((d) => ({ ...d, propertyScope }));
        }}
      />
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
        <input
          type="checkbox"
          name="isActive"
          checked={draft.isActive}
          disabled={rest.busy}
          onChange={(event) => {
            setDraft((d) => ({ ...d, isActive: event.target.checked }));
          }}
        />
        {userText('isActive')}
      </label>
      <p style={{ margin: 0 }}>{userText('accessNote')}</p>
      {changed ? null : <p style={{ margin: 0 }}>{userText('noChange')}</p>}
      {rest.failure === null ? null : (
        <WriteNotice
          failure={rest.failure}
          attemptedVersion={String(user.version)}
          onReload={rest.onReload}
        />
      )}
      <Actions
        busy={rest.busy}
        label={userText('submitAccess')}
        disabled={!changed}
        onCancel={rest.onCancel}
      />
    </form>
  );
}

export function PinConfirm({
  user,
  onConfirm,
  ...rest
}: Pick<FormProps, 'busy' | 'failure' | 'onCancel' | 'onReload'> & {
  user: UserSummary;
  onConfirm: () => void;
}): ReactElement {
  return (
    <section
      role="alertdialog"
      aria-labelledby="pin-title"
      aria-describedby="pin-warning"
      data-testid="pin-confirm"
      style={PANEL}
    >
      <h2 id="pin-title" style={heading}>
        {userText('pinTitle', { name: user.fullName })}
      </h2>
      <p id="pin-warning" style={{ margin: 0 }}>
        {userText('pinWarning')}
      </p>
      {rest.failure === null ? null : (
        <WriteNotice
          failure={rest.failure}
          attemptedVersion={String(user.version)}
          onReload={rest.onReload}
        />
      )}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          data-testid="pin-confirm-submit"
          style={CONTROL}
          disabled={rest.busy}
          onClick={onConfirm}
        >
          {rest.busy ? userText('submitting') : userText('pinConfirm')}
        </button>
        <button
          type="button"
          data-testid="pin-confirm-cancel"
          style={CONTROL}
          disabled={rest.busy}
          onClick={rest.onCancel}
        >
          {userText('cancel')}
        </button>
      </div>
    </section>
  );
}
