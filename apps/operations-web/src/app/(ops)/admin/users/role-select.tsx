'use client';
import type { ReactElement } from 'react';
import type { UserRole } from '@pinehill/contracts';
import { userText, type UserMessageKey } from './messages';
import { CONTROL, FIELD } from './styles';

export const roleLabel = (role: UserRole): string =>
  userText(`role${role}` satisfies UserMessageKey);

/** Chỉ hiện vai trò người đang đăng nhập được gán (QĐ-03 quyết định 7); `keep` giữ vai trò hiện tại để hiển thị đúng. */
export function RoleSelect({
  roles,
  value,
  keep,
  disabled,
  onChange,
}: {
  roles: readonly UserRole[];
  value: UserRole;
  keep?: UserRole;
  disabled: boolean;
  onChange: (role: UserRole) => void;
}): ReactElement {
  const shown = keep !== undefined && !roles.includes(keep) ? [keep, ...roles] : roles;
  return (
    <label style={FIELD}>
      {userText('role')}
      <select
        name="role"
        style={CONTROL}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const next = shown.find((role) => role === event.target.value);
          if (next !== undefined) onChange(next);
        }}
      >
        {shown.map((role) => (
          <option key={role} value={role}>
            {roleLabel(role)}
          </option>
        ))}
      </select>
    </label>
  );
}
