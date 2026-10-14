'use client';
/** SCR21: authoritative staff catalogue and symmetric readback after one connecting command. */
import { useEffect, useState, type ReactElement } from 'react';
import type { RoomSummary } from '@pinehill/contracts';
import { StateSurface } from '@pinehill/ui-web';
import { useForcedState } from '../../../components/forced-state';
import { t } from '../../../lib/i18n';
import { pairingCandidates, connectingCode } from '../../../lib/room-pairing';
import { VERSION_NEW } from '../../../lib/screen-state';
import { useAdmin } from '../admin-commands/use-admin';
import { AdminPanels } from '../admin-commands/panels';
import { adminText } from '../admin-commands/messages';
import { RoomTable, AssignForm } from './room-view';
interface Draft {
  source: RoomSummary;
  targetId: string;
  actorRevision: number;
}
function useRoomEditor(enabled: boolean) {
  const { state, controller } = useAdmin('connecting', enabled);
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    if (
      state.phase === 'expired' ||
      state.phase === 'forbidden' ||
      (state.actorVerified && !state.canWrite)
    )
      setDraft(null);
  }, [state.phase, state.actorVerified, state.canWrite]);
  useEffect(() => setDraft(null), [state.actorRevision]);
  useEffect(() => {
    if (state.receipt?.kind === 'connecting-update') setDraft(null);
  }, [state.receipt]);
  const rooms = state.data?.rooms ?? [],
    types = state.data?.roomTypes ?? [];
  const current = rooms.find((room) => room.id === draft?.source.id);
  const receipt = state.receipt?.kind === 'connecting-update' ? state.receipt.data : null;
  const save = async (pending: Draft) => {
    if (!controller) return;
    await controller.save({
      kind: 'connecting-update',
      targetId: pending.source.id,
      tag: '"' + pending.source.version + '"',
      body: { connectingRoomId: pending.targetId || null },
    });
  };
  const unassign = async (room: RoomSummary) => {
    const pending = { source: room, targetId: '', actorRevision: state.actorRevision };
    setDraft(pending);
    await save(pending);
  };
  const adopt = () => {
    if (!draft || !current || !state.canCompare) return;
    setDraft({ ...draft, source: { ...draft.source, version: current.version } });
    controller?.adoptVersion();
  };
  return {
    state,
    controller,
    draft,
    setDraft,
    rooms,
    types,
    current,
    receipt,
    save,
    unassign,
    adopt,
  };
}
type Model = ReturnType<typeof useRoomEditor>;
function Comparison({ model }: { model: Model }): ReactElement | null {
  const { state, current, rooms, adopt } = model;
  if (state.phase !== 'conflict' || !state.canCompare || !current) return null;
  return (
    <div data-testid="room-comparison">
      <p>
        {adminText('current', { name: current.code, version: current.version })} ·{' '}
        {connectingCode(rooms, current.id) ?? '—'}
      </p>
      <button type="button" disabled={state.busy} onClick={adopt} style={{ minHeight: 44 }}>
        {adminText('adopt')}
      </button>
    </div>
  );
}
function visibleDraft(model: Model): Draft | null {
  return model.state.canWrite &&
    model.draft?.actorRevision === model.state.actorRevision &&
    model.current !== undefined
    ? model.draft
    : null;
}
function Body({ model }: { model: Model }): ReactElement {
  const { state, controller, setDraft, rooms, types, receipt, save, unassign } = model;
  const draft = visibleDraft(model);
  return (
    <>
      {receipt ? (
        <p role="status" data-testid="assign-success" style={{ margin: 0 }}>
          {t('rooms.saved', { code: receipt.code })}
        </p>
      ) : null}
      {rooms.length ? (
        <RoomTable
          rooms={rooms}
          roomTypes={types}
          canEdit={state.canWrite && !!controller?.canStart()}
          onAssign={(room) => {
            controller?.clearValidation();
            setDraft({
              source: room,
              targetId: room.connectingRoomId ?? '',
              actorRevision: state.actorRevision,
            });
          }}
          onUnassign={(room) => void unassign(room)}
        />
      ) : null}
      {draft ? (
        <AssignForm
          room={draft.source}
          candidates={pairingCandidates(rooms, draft.source.id)}
          disabled={state.busy || !controller?.canStart()}
          targetId={draft.targetId}
          onChange={(value) => setDraft({ ...draft, targetId: value })}
          onSubmit={(event) => {
            event.preventDefault();
            if (draft) void save(draft);
          }}
          onCancel={() => {
            setDraft(null);
            controller?.clearValidation();
          }}
        />
      ) : null}
    </>
  );
}
export function RoomsScreen(): ReactElement {
  const forced = useForcedState();
  const model = useRoomEditor(forced === undefined);
  const { state, controller, draft } = model;
  if (forced !== undefined)
    return (
      <StateSurface state={forced}>
        <p>{t('screen.demo')}</p>
      </StateSurface>
    );
  return (
    <section
      style={{
        padding: 'var(--space-s6, 24px)',
        display: 'grid',
        gap: 'var(--space-s4, 16px)',
        minWidth: 0,
      }}
    >
      <h1 style={{ margin: 0 }}>{t('rooms.title')}</h1>
      <p style={{ margin: 0 }}>{t('rooms.intro')}</p>
      <button
        type="button"
        disabled={state.busy}
        onClick={() => void controller?.load()}
        style={{ minHeight: 44, justifySelf: 'start' }}
      >
        {t('rooms.reload')}
      </button>
      <AdminPanels
        state={state}
        controller={controller}
        version={String(draft?.source.version ?? VERSION_NEW)}
      />
      <Comparison model={model} />
      <Body model={model} />
    </section>
  );
}
