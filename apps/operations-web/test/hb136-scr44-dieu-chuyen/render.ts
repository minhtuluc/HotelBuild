import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ControllerState } from '../../src/features/hb136-scr44-dieu-chuyen/controller';
import { MovePanel } from '../../src/features/hb136-scr44-dieu-chuyen/move';
import { CommandStatus } from '../../src/features/hb136-scr44-dieu-chuyen/status';

export const noop = () => undefined;

export const failed = (state: ControllerState) =>
  renderToStaticMarkup(
    createElement(CommandStatus, {
      command: state.command,
      pending: state.pending,
      intentState: state.intentState,
      actions: { retry: noop, lookup: noop, discard: noop },
    }),
  );
export const panel = (state: ControllerState) =>
  renderToStaticMarkup(
    createElement(MovePanel, {
      move: state.move ?? fail(),
      role: state.actor?.role ?? 'SYSADMIN',
      busy: false,
      serverIssues: [],
      onApprove: noop,
      onExecute: noop,
    }),
  );

function fail(): never {
  throw new Error('Không có điều chuyển trong state');
}
