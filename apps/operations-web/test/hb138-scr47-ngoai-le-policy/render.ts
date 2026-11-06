import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ControllerState } from '../../src/features/hb138-scr47-ngoai-le-policy/controller';
import { emptyFilter, type Filter } from '../../src/features/hb138-scr47-ngoai-le-policy/model';
import { CommandStatus } from '../../src/features/hb138-scr47-ngoai-le-policy/status';
import { ExceptionTable } from '../../src/features/hb138-scr47-ngoai-le-policy/table';

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

export const tableMarkup = (state: ControllerState, filter: Filter = emptyFilter) =>
  renderToStaticMarkup(
    createElement(ExceptionTable, {
      list: state.list,
      filter,
      actor: state.actor ?? { role: 'SYSADMIN', userId: '' },
      busy: false,
      serverIssues: [],
      onMore: noop,
      onDecide: noop,
    }),
  );
