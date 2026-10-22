'use client';
import { useState, type ReactElement } from 'react';
import {
  StateSurface,
  color,
  formatDateTimeVn,
  space,
  typography,
  type ScreenState,
} from '@pinehill/ui-web';
import { useForcedState } from '../../../../components/forced-state';
import { ScreenAlert } from '../../../../components/screen-alert';
import { t } from '../../../../lib/i18n';
import type { UsersController, UsersState } from './controller';
import { HandoverPanel } from './handover-panel';
import { roleLabel } from './role-select';
import { CONTROL, FIELD } from './styles';
import { AccessEditor, CreateForm, PinConfirm } from './user-forms';
import { ROLES, canManageUsers, type UserFilters } from './users-model';
import { UsersTable } from './users-table';
import { useUsers } from './use-users';
import { userText } from './messages';

function surface(state: UsersState): ScreenState {
  if (state.phase === 'forbidden') return { kind: 'forbidden' };
  if (state.phase === 'loading' && state.rows.length === 0) return { kind: 'loading' };
  if (state.phase === 'ready' && state.rows.length === 0 && state.error === null)
    return {
      kind: 'empty',
      reason:
        state.filters.q !== '' || state.filters.role !== '' || state.filters.propertyId !== ''
          ? 'filtered'
          : 'noData',
      canCreate: false,
    };
  return { kind: 'ready' };
}

function Filters({
  state,
  controller,
}: {
  state: UsersState;
  controller: UsersController;
}): ReactElement {
  const [draft, setDraft] = useState<UserFilters>(state.filters);
  return (
    <form
      aria-label={userText('list')}
      data-testid="users-filters"
      style={{ display: 'flex', flexWrap: 'wrap', gap: space.s3, alignItems: 'end' }}
      onSubmit={(event) => {
        event.preventDefault();
        void controller.reload(draft);
      }}
    >
      <label style={FIELD}>
        {userText('filterRole')}
        <select
          name="role"
          style={CONTROL}
          value={draft.role}
          onChange={(event) => {
            const role = ROLES.find((item) => item === event.target.value);
            setDraft({ ...draft, role: role ?? '' });
          }}
        >
          <option value="">{userText('filterAll')}</option>
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {roleLabel(role)}
            </option>
          ))}
        </select>
      </label>
      {state.properties === null ? null : (
        <label style={FIELD}>
          {userText('filterProperty')}
          <select
            name="propertyId"
            style={CONTROL}
            value={draft.propertyId}
            onChange={(event) => {
              setDraft({ ...draft, propertyId: event.target.value });
            }}
          >
            <option value="">{userText('filterAll')}</option>
            {state.properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label style={FIELD}>
        {userText('filterQuery')}
        <input
          name="q"
          style={CONTROL}
          value={draft.q}
          onChange={(event) => {
            setDraft({ ...draft, q: event.target.value });
          }}
        />
      </label>
      <button type="submit" data-testid="users-apply" style={CONTROL} disabled={state.refreshing}>
        {userText('apply')}
      </button>
    </form>
  );
}

function Panels({
  state,
  controller,
}: {
  state: UsersState;
  controller: UsersController;
}): ReactElement | null {
  const actor = state.actor;
  const panel = state.panel;
  if (actor === null || panel === null) return null;
  const common = {
    properties: state.properties,
    busy: state.busy,
    failure: state.failure,
    onCancel: () => {
      controller.openPanel(null);
    },
    onReload: () => {
      void controller.reload();
    },
  };
  if (panel.kind === 'create')
    return (
      <CreateForm
        {...common}
        actorRole={actor.role}
        issues={state.issues}
        onSubmit={(draft) => void controller.create(draft)}
      />
    );
  const user = state.rows.find((row) => row.id === panel.userId);
  if (user === undefined) return null;
  if (panel.kind === 'pin')
    return <PinConfirm {...common} user={user} onConfirm={() => void controller.clearPin(user)} />;
  return (
    <AccessEditor
      key={`${user.id}:${user.version}`}
      {...common}
      user={user}
      actorRole={actor.role}
      onSave={(draft) => void controller.saveAccess(user, draft)}
    />
  );
}

function Notices({
  state,
  controller,
}: {
  state: UsersState;
  controller: UsersController;
}): ReactElement {
  return (
    <>
      {state.notice === null ? null : (
        <p role="status" data-testid="users-notice" style={{ margin: 0, color: color.text }}>
          {userText(state.notice)}
        </p>
      )}
      {state.handover === null ? null : (
        <HandoverPanel
          handover={state.handover}
          onDone={() => {
            controller.dismissHandover();
          }}
        />
      )}
      {state.error === null || state.phase !== 'ready' ? null : (
        <ScreenAlert
          error={state.error}
          onRetry={() => {
            void controller.reload();
          }}
        />
      )}
    </>
  );
}

function Toolbar({
  state,
  controller,
}: {
  state: UsersState;
  controller: UsersController;
}): ReactElement {
  return (
    <div style={{ display: 'flex', gap: space.s3, flexWrap: 'wrap', alignItems: 'center' }}>
      {state.actor !== null && canManageUsers(state.actor.role) ? (
        <button
          type="button"
          data-testid="users-create-open"
          style={CONTROL}
          onClick={() => {
            controller.openPanel({ kind: 'create' });
          }}
        >
          {userText('createButton')}
        </button>
      ) : null}
      <button
        type="button"
        data-testid="users-reload"
        style={CONTROL}
        disabled={state.refreshing || state.phase === 'loading'}
        onClick={() => {
          void controller.reload();
        }}
      >
        {userText('reload')}
      </button>
      {state.syncedAt === null ? null : (
        <span data-testid="users-synced">
          {userText('synced', { time: formatDateTimeVn(new Date(state.syncedAt).toISOString()) })}
        </span>
      )}
    </div>
  );
}

function Loaded({
  state,
  controller,
}: {
  state: UsersState;
  controller: UsersController;
}): ReactElement {
  const actor = state.actor;
  return (
    <>
      <Toolbar state={state} controller={controller} />
      <Notices state={state} controller={controller} />
      <Panels state={state} controller={controller} />
      <Filters state={state} controller={controller} />
      <StateSurface state={surface(state)}>
        {actor === null || state.rows.length === 0 ? null : (
          <UsersTable
            rows={state.rows}
            actor={actor.role}
            actorId={actor.userId}
            properties={state.properties}
            nowMs={state.syncedAt ?? 0}
            onEdit={(user) => {
              controller.openPanel({ kind: 'access', userId: user.id });
            }}
            onClearPin={(user) => {
              controller.openPanel({ kind: 'pin', userId: user.id });
            }}
          />
        )}
      </StateSurface>
      {state.nextCursor === null ? null : (
        <button
          type="button"
          data-testid="users-more"
          style={CONTROL}
          disabled={state.refreshing}
          onClick={() => {
            void controller.loadMore();
          }}
        >
          {userText('loadMore')}
        </button>
      )}
    </>
  );
}

function Body({
  state,
  controller,
}: {
  state: UsersState | null;
  controller: UsersController | null;
}): ReactElement {
  if (state === null || controller === null) return <StateSurface state={{ kind: 'loading' }} />;
  if (state.phase === 'expired')
    return (
      <p role="alert" data-testid="users-expired" style={{ margin: 0 }}>
        {userText('expired')}
      </p>
    );
  if (state.phase === 'error' && state.rows.length === 0)
    return (
      <ScreenAlert
        error={state.error}
        onRetry={() => {
          void controller.load();
        }}
      />
    );
  return <Loaded state={state} controller={controller} />;
}

/** SCR-15 — người dùng, vai trò & phạm vi cơ sở (UC-AUTH-02). Máy chủ (HB-016) cưỡng chế mọi luật gán. */
export function UsersScreen({ baseUrl }: { baseUrl: string }): ReactElement {
  const forced = useForcedState();
  const { controller, state } = useUsers(baseUrl, forced === undefined);
  return (
    <section
      data-testid="users-screen"
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr)',
        gap: space.s4,
        padding: `${space.s4} 0`,
        maxWidth: 1280,
      }}
    >
      <h1 style={{ margin: 0, fontSize: typography.h1.web }}>{userText('title')}</h1>
      <p style={{ margin: 0, color: color.textMuted }}>{userText('intro')}</p>
      {forced === undefined ? (
        <Body state={state} controller={controller} />
      ) : (
        <StateSurface state={forced}>
          <p>{t('screen.demo')}</p>
        </StateSurface>
      )}
    </section>
  );
}
