'use client';
/** SCR22: authoritative scoped catalogues and staff commands; inventory and override remain server owned. */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { StateSurface, color } from '@pinehill/ui-web';
import {
  OPS_COMPACT_BTN_STYLE,
  OPS_FIELD_LABEL_STYLE,
  OPS_FILTER_ROW_STYLE,
  OPS_HEADER_ROW_STYLE,
  OPS_HEADER_STYLE,
  OPS_INTRO_STYLE,
  OPS_PAGE_STYLE,
  OPS_TITLE_STYLE,
  opsNoticeStyle,
} from '../../../components/editorial-styles';
import { useForcedState } from '../../../components/forced-state';
import { t } from '../../../lib/i18n';
import { businessDate } from '../../../lib/inventory-grid';
import {
  EMPTY_ROOM_BLOCK_DRAFT,
  conflictingBlocks,
  toCreateRequest,
  validateDraft,
  type RoomBlockDraft,
} from '../../../lib/room-blocks';
import { useAdmin } from '../admin-commands/use-admin';
import { AdminPanels } from '../admin-commands/panels';
import { BlockTable, BlockForm } from './block-view';
import {
  selection,
  visibleDraft,
  visibleRemoval as currentRemoval,
  type Editor,
  type Removal,
} from './editor';
import { blockText } from './messages';
const emptyDraft = (): RoomBlockDraft => ({
  ...EMPTY_ROOM_BLOCK_DRAFT,
  startDate: businessDate(new Date()),
});
function useBlocks(enabled: boolean) {
  const { state, controller } = useAdmin('room-block', enabled);
  const [chosenId, setChosenId] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [initial] = useState(emptyDraft);
  useEffect(() => {
    if (
      state.phase === 'expired' ||
      state.phase === 'forbidden' ||
      (state.actorVerified && !state.canWrite)
    ) {
      setEditor(null);
      setRemoval(null);
      setChosenId('');
    }
  }, [state.phase, state.actorVerified, state.canWrite]);
  useEffect(() => {
    setEditor(null);
    setRemoval(null);
    setChosenId('');
  }, [state.actorRevision]);
  useEffect(() => {
    if (state.receipt?.kind === 'room-block-create') setEditor(null);
    if (state.receipt?.kind === 'room-block-delete') setRemoval(null);
  }, [state.receipt]);
  const { properties, propertyId, rooms, blocks, roomIds } = selection(state, chosenId);
  const draft = visibleDraft(state, editor, propertyId, roomIds, initial);
  const visibleRemoval = currentRemoval(state, removal, propertyId, blocks);
  const onChange = (data: RoomBlockDraft) => {
    controller?.clearValidation();
    setEditor({ propertyId, revision: state.actorRevision, data });
  };
  const changeProperty = (id: string) => {
    setChosenId(id);
    setEditor(null);
    setRemoval(null);
    controller?.clearValidation();
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!controller?.canStart()) return;
    const issues = [...validateDraft(draft)];
    if (draft.roomId !== '' && !roomIds.has(draft.roomId))
      issues.push({ field: 'roomId', issue: 'INVALID' });
    if (issues.length) {
      controller.validation(issues);
      return;
    }
    await controller.save({ kind: 'room-block-create', body: toCreateRequest(draft) });
  };
  const remove = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!visibleRemoval || !controller?.canStart()) return;
    if (!visibleRemoval.reason.trim()) {
      controller.validation([{ field: 'reason', issue: 'REQUIRED' }]);
      return;
    }
    await controller.save({
      kind: 'room-block-delete',
      targetId: visibleRemoval.block.id,
      reason: visibleRemoval.reason,
    });
  };
  return {
    state,
    controller,
    properties,
    propertyId,
    rooms,
    blocks,
    draft,
    visibleRemoval,
    setRemoval,
    onChange,
    changeProperty,
    submit,
    remove,
  };
}
type Model = ReturnType<typeof useBlocks>;
function Body({ model }: { model: Model }): ReactElement {
  const { state, controller, propertyId, rooms, blocks, draft, setRemoval, onChange, submit } =
    model;
  const disabled = !controller?.canStart();
  const conflicts = conflictingBlocks(draft, blocks);
  return (
    <>
      <Receipt model={model} />
      <PropertyPicker model={model} />
      {state.canWrite && propertyId ? (
        <>
          <BlockForm
            draft={draft}
            rooms={rooms}
            disabled={disabled}
            onChange={onChange}
            onSubmit={(event) => void submit(event)}
          />
          <p style={{ margin: 0, fontSize: 13, color: color.textMuted }}>{blockText('dateHelp')}</p>
          {conflicts.length ? (
            <p
              role="alert"
              data-testid="room-block-overlap"
              style={{ ...opsNoticeStyle('warning'), color: color.warning, fontWeight: 500 }}
            >
              {t('roomBlocks.overlap', { count: conflicts.length })}
            </p>
          ) : null}
        </>
      ) : null}
      {blocks.length ? (
        <BlockTable
          blocks={blocks}
          rooms={rooms}
          canRemove={state.canRemove && !disabled}
          onRemove={(block) => {
            controller?.clearValidation();
            setRemoval({ propertyId, revision: state.actorRevision, block, reason: '' });
          }}
        />
      ) : null}
      <RemovalForm model={model} />
    </>
  );
}
function Receipt({ model }: { model: Model }): ReactElement {
  const { state } = model;
  return (
    <>
      {state.receipt?.kind === 'room-block-create' ||
      state.receipt?.kind === 'room-block-delete' ? (
        <p
          role="status"
          data-testid="room-block-success"
          style={{ ...opsNoticeStyle('success'), color: color.success, fontWeight: 500 }}
        >
          {state.receipt.kind === 'room-block-create' ? blockText('created') : blockText('removed')}
        </p>
      ) : null}
    </>
  );
}
function PropertyPicker({ model }: { model: Model }): ReactElement {
  const { properties, propertyId, state, changeProperty } = model;
  return (
    <>
      {properties.length ? (
        <label style={{ ...OPS_FIELD_LABEL_STYLE, maxWidth: 320 }}>
          {t('roomBlocks.form.property')}
          <select
            value={propertyId}
            disabled={state.busy || state.phase === 'unknown'}
            onChange={(event) => changeProperty(event.target.value)}
          >
            {properties.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </>
  );
}
function RemovalForm({ model }: { model: Model }): ReactElement {
  const { visibleRemoval, controller, state, setRemoval, remove } = model;
  const disabled = !controller?.canStart();
  return (
    <>
      {visibleRemoval ? (
        <form
          data-testid="room-block-remove"
          onSubmit={(event) => void remove(event)}
          className="ph-card ph-filter-row"
          style={OPS_FILTER_ROW_STYLE}
        >
          <label style={OPS_FIELD_LABEL_STYLE}>
            {t('roomBlocks.form.removeReason')}
            <input
              maxLength={500}
              value={visibleRemoval.reason}
              disabled={disabled}
              onChange={(event) => {
                controller?.clearValidation();
                setRemoval({ ...visibleRemoval, reason: event.target.value });
              }}
            />
          </label>
          <button
            type="submit"
            disabled={disabled}
            className="ph-btn-primary"
            style={OPS_COMPACT_BTN_STYLE}
          >
            {t('roomBlocks.removeConfirm')}
          </button>
          <button
            type="button"
            disabled={state.busy}
            className="ph-btn"
            style={OPS_COMPACT_BTN_STYLE}
            onClick={() => {
              setRemoval(null);
              controller?.clearValidation();
            }}
          >
            {blockText('cancel')}
          </button>
        </form>
      ) : null}
    </>
  );
}
export function RoomBlocksScreen(): ReactElement {
  const forced = useForcedState();
  const model = useBlocks(forced === undefined);
  if (forced !== undefined)
    return (
      <StateSurface state={forced}>
        <p>{t('screen.demo')}</p>
      </StateSurface>
    );
  return (
    <section style={OPS_PAGE_STYLE}>
      <div style={OPS_HEADER_ROW_STYLE}>
        <div style={OPS_HEADER_STYLE}>
          <h1 style={OPS_TITLE_STYLE}>{t('roomBlocks.title')}</h1>
          <p style={OPS_INTRO_STYLE}>{t('roomBlocks.intro')}</p>
        </div>
        <button
          type="button"
          disabled={model.state.busy}
          onClick={() => void model.controller?.load()}
          className="ph-btn"
          style={OPS_COMPACT_BTN_STYLE}
        >
          {blockText('reload')}
        </button>
      </div>
      <AdminPanels state={model.state} controller={model.controller} />
      <Body model={model} />
    </section>
  );
}
