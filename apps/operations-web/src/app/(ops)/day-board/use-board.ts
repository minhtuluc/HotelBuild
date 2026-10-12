'use client';
import { useEffect, useMemo, useState } from 'react';
import { ApiClient, ApiError } from '@pinehill/api-client';
import { createSessionClient } from '@pinehill/web-session/client';
import { DayBoardController } from './controller';
import { dayApi } from './api';

function createBoard(baseUrl: string, initialDay: string) {
  let session: ReturnType<typeof createSessionClient> | undefined;
  let active = true;
  const token = async () => {
    if (!active) throw new ApiError({ kind: 'aborted', message: 'Unmounted' });
    session ??= createSessionClient({ kind: 'staff', onExpired: () => board.deny() });
    const value = await session.getAccessToken();
    if (!value || !active)
      throw new ApiError({ kind: 'http', status: 401, message: 'Expired session' });
    return value;
  };
  const client = new ApiClient({ baseUrl, maxAttempts: 2, getAccessToken: token });
  const board = new DayBoardController(dayApi(client), initialDay);
  return {
    board,
    start: () => {
      active = true;
    },
    dispose: () => {
      active = false;
      board.dispose();
      session?.dispose();
      session = undefined;
    },
  };
}
export function useDayBoard(baseUrl: string, initialDay: string, enabled: boolean) {
  const workspace = useMemo(() => createBoard(baseUrl, initialDay), [baseUrl, initialDay]);
  const [state, setState] = useState(workspace.board.state);
  useEffect(() => {
    workspace.start();
    const unsubscribe = workspace.board.subscribe(() => setState(workspace.board.state));
    if (enabled) void workspace.board.load();
    return () => {
      unsubscribe();
      workspace.dispose();
    };
  }, [enabled, workspace]);
  return { controller: workspace.board, state };
}
