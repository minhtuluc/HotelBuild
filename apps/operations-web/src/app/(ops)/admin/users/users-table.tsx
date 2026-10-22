'use client';
import type { ReactElement } from 'react';
import type { UserSummary } from '@pinehill/contracts';
import { formatDateTimeVn, space } from '@pinehill/ui-web';
import type { PropertyOption } from './controller';
import { roleLabel } from './role-select';
import { CONTROL } from './styles';
import { canClearPin, canManageUsers, isLocked } from './users-model';
import { userText } from './messages';
import type { UserRole } from '@pinehill/contracts';

const CELL = { padding: space.s2, textAlign: 'left', verticalAlign: 'top' } as const;

function scopeText(user: UserSummary, properties: readonly PropertyOption[] | null): string {
  if (user.role === 'OWNER' && user.propertyScope.length === 0) return userText('allProperties');
  if (user.propertyScope.length === 0) return userText('noScope');
  const names = new Map((properties ?? []).map((property) => [property.id, property.name]));
  return user.propertyScope.map((id) => names.get(id) ?? id).join(', ');
}

function RowActions({
  user,
  actor,
  isSelf,
  onEdit,
  onClearPin,
}: {
  user: UserSummary;
  actor: UserRole;
  isSelf: boolean;
  onEdit: (user: UserSummary) => void;
  onClearPin: (user: UserSummary) => void;
}): ReactElement {
  return (
    <div style={{ display: 'flex', gap: space.s2, flexWrap: 'wrap' }}>
      {canManageUsers(actor) && !isSelf ? (
        <button
          type="button"
          data-testid={`edit-${user.id}`}
          style={CONTROL}
          aria-label={userText('editFor', { name: user.fullName })}
          onClick={() => {
            onEdit(user);
          }}
        >
          {userText('edit')}
        </button>
      ) : null}
      {canClearPin(actor) && !isSelf && user.hasPin ? (
        <button
          type="button"
          data-testid={`clear-pin-${user.id}`}
          style={CONTROL}
          aria-label={userText('clearPinFor', { name: user.fullName })}
          onClick={() => {
            onClearPin(user);
          }}
        >
          {userText('clearPin')}
        </button>
      ) : null}
      {isSelf ? <span>{userText('self')}</span> : null}
    </div>
  );
}

export function UsersTable({
  rows,
  actor,
  actorId,
  properties,
  nowMs,
  onEdit,
  onClearPin,
}: {
  rows: readonly UserSummary[];
  actor: UserRole;
  actorId: string;
  properties: readonly PropertyOption[] | null;
  nowMs: number;
  onEdit: (user: UserSummary) => void;
  onClearPin: (user: UserSummary) => void;
}): ReactElement {
  return (
    <div role="region" aria-label={userText('list')} tabIndex={0} style={{ overflowX: 'auto' }}>
      <table
        data-testid="users-table"
        style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720 }}
      >
        <caption style={{ textAlign: 'left', padding: space.s2 }}>{userText('list')}</caption>
        <thead>
          <tr>
            {(
              [
                'colUsername',
                'colName',
                'colRole',
                'colScope',
                'colStatus',
                'colLocked',
                'colPin',
                'colActions',
              ] as const
            ).map((key) => (
              <th key={key} scope="col" style={CELL}>
                {userText(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((user) => (
            <tr key={user.id} data-testid={`user-row-${user.id}`}>
              <th scope="row" style={CELL}>
                {user.username}
              </th>
              <td style={CELL}>{user.fullName}</td>
              <td style={CELL}>{roleLabel(user.role)}</td>
              <td style={CELL}>{scopeText(user, properties)}</td>
              <td style={CELL}>{user.isActive ? userText('active') : userText('inactive')}</td>
              <td style={CELL}>
                {isLocked(user, nowMs) && user.lockedUntil !== null
                  ? userText('locked', { time: formatDateTimeVn(user.lockedUntil) })
                  : userText('notLocked')}
              </td>
              <td style={CELL}>{user.hasPin ? userText('hasPin') : userText('noPin')}</td>
              <td style={CELL}>
                <RowActions
                  user={user}
                  actor={actor}
                  isSelf={user.id === actorId}
                  onEdit={onEdit}
                  onClearPin={onClearPin}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
