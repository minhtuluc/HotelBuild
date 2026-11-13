'use client';
import type { ReactElement } from 'react';
import { color, fontFamily, formatDateTimeVn, radius, space, typography } from '@pinehill/ui-web';
import { FilterForm } from './filter';
import { text } from './messages';
import { canResolve, emptyConfirmed, type FieldIssue } from './model';
import { CommandStatus, ReadBanner } from './status';
import { CaseTable } from './table';
import type { CaseController, ControllerState, Rows } from './controller';
import { useCases } from './use-cases';

function serverIssues(state: ControllerState): readonly FieldIssue[] {
  const { command } = state;
  return command.kind === 'failed' && command.failure.kind === 'validation'
    ? command.failure.issues
    : [];
}

function scanText(list: Rows): string {
  const { scan } = list;
  const at = scan.lastSuccessAt === null ? text('never') : formatDateTimeVn(scan.lastSuccessAt);
  // Đang quét mà đã có lượt thành công trước đó: dữ liệu hiện là của lượt đó (HB-220).
  if (scan.status === 'SUCCEEDED' || (scan.status === 'RUNNING' && scan.lastSuccessAt !== null))
    return text('scanOk', { time: at });
  return scan.status === 'FAILED' ? text('scanFailed', { time: at }) : text('scanUnknown');
}

/** Độ tươi của lượt quét + số ca quá hạn do máy chủ đếm; dữ liệu cũ được gắn nhãn thời điểm. */
function ScanPanel({ list }: { list: Rows }): ReactElement {
  const ok = list.scan.status === 'SUCCEEDED';
  const failed = list.scan.status === 'FAILED';
  const accent = ok ? color.success : failed ? color.danger : color.warning;
  const hasOverdue = list.overdueCount > 0;
  return (
    <section
      aria-label={text('scanOk', { time: '' })}
      data-testid="hb135-scan"
      className="ph-card"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: space.s3,
        justifyContent: 'space-between',
        alignItems: 'center',
        boxShadow: `inset 0 0 0 1px ${accent}`,
        padding: `${space.s3}px ${space.s4}px`,
      }}
    >
      <p role={ok ? 'status' : 'alert'} style={{ margin: 0, color: color.text }}>
        {scanText(list)}
      </p>
      <p
        style={{
          margin: 0,
          padding: '4px 10px',
          borderRadius: radius.sm,
          fontSize: 13,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          background: hasOverdue ? '#FADDDD' : '#E7F3EE',
          color: hasOverdue ? '#991B1B' : color.success,
          border: `1px solid ${hasOverdue ? color.danger : color.border}`,
        }}
      >
        {text('overdueCount', { count: list.overdueCount })}
      </p>
    </section>
  );
}

function Workspace({
  state,
  controller,
}: {
  state: ControllerState;
  controller: CaseController;
}): ReactElement {
  const role = state.actor?.role;
  const busy = state.command.kind === 'sending';
  return (
    <>
      <FilterForm
        value={state.filter}
        properties={state.properties}
        roomTypes={state.roomTypes}
        busy={busy}
        onApply={(filter) => void controller.applyFilter(filter)}
      />
      {state.list === null ? null : <ScanPanel list={state.list} />}
      <div aria-live="polite" data-testid="hb135-command">
        <CommandStatus
          command={state.command}
          pending={state.pending}
          actions={{
            retry: () => void controller.retry(),
            lookup: () => void controller.load(),
            discard: () => controller.discardPending(),
          }}
        />
      </div>
      <CaseTable
        list={state.list}
        confirmedEmpty={state.list !== null && emptyConfirmed(state.list.scan)}
        canResolve={role !== undefined && canResolve(role)}
        busy={busy}
        serverIssues={serverIssues(state)}
        onMore={() => void controller.loadMore()}
        onResolve={(id, note) => void controller.submitResolve(id, note)}
      />
    </>
  );
}

export function OverbookingCasesScreen(): ReactElement {
  const { state, controller } = useCases();
  const denied = state.phase === 'forbidden' || state.phase === 'expired';
  const busy = state.command.kind === 'sending';
  return (
    <section
      style={{
        maxWidth: 1360,
        marginInline: 'auto',
        padding: `clamp(${space.s4}px, 3vw, ${space.s6}px)`,
        display: 'grid',
        gap: space.s4,
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: space.s3,
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'grid', gap: space.s1 }}>
          <h1 style={{ margin: 0, fontFamily: fontFamily.sans, fontSize: typography.h1.web }}>
            {text('title')}
          </h1>
          <p style={{ margin: 0, color: color.textMuted, maxWidth: '58rem' }}>{text('intro')}</p>
        </div>
        {!denied && controller !== null && state.list !== null ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void controller.load()}
            className="ph-btn"
          >
            {text('reload')}
          </button>
        ) : null}
      </div>
      {denied ? (
        <p
          role="alert"
          style={{
            margin: 0,
            padding: `${space.s3}px ${space.s4}px`,
            background: '#FDF3F3',
            border: `1px solid ${color.border}`,
            boxShadow: `inset 0 0 0 1px ${color.danger}`,
            borderRadius: radius.sm,
            color: color.danger,
          }}
        >
          {text(state.phase === 'expired' ? 'expired' : 'forbidden')}
        </p>
      ) : null}
      <ReadBanner state={state} />
      {!denied && controller !== null && state.list !== null ? (
        <Workspace state={state} controller={controller} />
      ) : null}
    </section>
  );
}
