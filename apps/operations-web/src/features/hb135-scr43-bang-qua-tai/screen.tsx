'use client';
import type { ReactElement } from 'react';
import { formatDateTimeVn } from '@pinehill/ui-web';
import { FilterForm } from './filter';
import { text } from './messages';
import { canResolve, emptyConfirmed, type FieldIssue } from './model';
import { box } from './parts';
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
  return (
    <section aria-label={text('scanOk', { time: '' })} data-testid="hb135-scan" style={box}>
      <p role={list.scan.status === 'SUCCEEDED' ? 'status' : 'alert'}>{scanText(list)}</p>
      <p>{text('overdueCount', { count: list.overdueCount })}</p>
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
      <button
        type="button"
        disabled={busy}
        onClick={() => void controller.load()}
        style={{ minHeight: 44, justifySelf: 'start' }}
      >
        {text('reload')}
      </button>
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
  return (
    <section style={{ padding: 'var(--space-s6, 24px)', ...box, gap: 'var(--space-s4, 16px)' }}>
      <h1 style={{ margin: 0 }}>{text('title')}</h1>
      <p>{text('intro')}</p>
      {denied ? (
        <p role="alert">{text(state.phase === 'expired' ? 'expired' : 'forbidden')}</p>
      ) : null}
      <ReadBanner state={state} />
      {!denied && controller !== null && state.list !== null ? (
        <Workspace state={state} controller={controller} />
      ) : null}
    </section>
  );
}
