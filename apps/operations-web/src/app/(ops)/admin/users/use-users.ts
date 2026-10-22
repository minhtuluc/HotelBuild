'use client';
import { useEffect, useState } from 'react';
import { createUsersWorkspace } from './users-api';
import type { UsersController, UsersState } from './controller';

export interface UsersView {
  readonly controller: UsersController | null;
  readonly state: UsersState | null;
}

/** Dựng phiên + bộ điều khiển khi mount và huỷ khi unmount (StrictMode chạy effect hai lần ở dev). */
export function useUsers(baseUrl: string, enabled: boolean): UsersView {
  const [view, setView] = useState<UsersView>({ controller: null, state: null });
  useEffect(() => {
    if (!enabled) return;
    const workspace = createUsersWorkspace(baseUrl);
    const { controller } = workspace;
    setView({ controller, state: controller.state });
    const unsubscribe = controller.subscribe(() => {
      setView({ controller, state: controller.state });
    });
    void controller.load();
    return () => {
      unsubscribe();
      workspace.dispose();
    };
  }, [baseUrl, enabled]);
  return view;
}
