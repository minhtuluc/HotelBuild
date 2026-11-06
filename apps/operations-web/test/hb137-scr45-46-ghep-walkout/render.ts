import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ControllerState } from '../../src/features/hb137-scr45-46-ghep-walkout/controller';
import { MergePanel } from '../../src/features/hb137-scr45-46-ghep-walkout/merge';
import { CommandStatus } from '../../src/features/hb137-scr45-46-ghep-walkout/status';
import {
  CompensationPanel,
  WalkOutPanel,
} from '../../src/features/hb137-scr45-46-ghep-walkout/walkout';

export const noop = () => undefined;

function fail(): never {
  throw new Error('Thiếu dữ liệu trong state');
}

export const failed = (state: ControllerState) =>
  renderToStaticMarkup(
    createElement(CommandStatus, {
      command: state.command,
      pending: state.pending,
      intentState: state.intentState,
      actions: { retry: noop, lookup: noop, discard: noop },
    }),
  );

export const mergeMarkup = (state: ControllerState) =>
  renderToStaticMarkup(
    createElement(MergePanel, {
      merge: state.merge ?? fail(),
      role: state.actor?.role ?? fail(),
      busy: false,
      serverIssues: [],
      onConsent: noop,
      onApprove: noop,
      onExecute: noop,
    }),
  );

export const walkMarkup = (state: ControllerState) =>
  renderToStaticMarkup(
    createElement(WalkOutPanel, {
      move: state.move ?? fail(),
      role: state.actor?.role ?? fail(),
      busy: false,
      serverIssues: [],
      onApprove: noop,
      onExecute: noop,
    }),
  );

export const payMarkup = (state: ControllerState) =>
  renderToStaticMarkup(
    createElement(CompensationPanel, {
      move: state.move ?? fail(),
      payments: state.payments,
      role: state.actor?.role ?? fail(),
      busy: false,
      serverIssues: [],
      onPay: noop,
    }),
  );
