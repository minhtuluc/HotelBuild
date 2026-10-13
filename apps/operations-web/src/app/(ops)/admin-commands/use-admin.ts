import { useEffect, useState } from 'react';
import { AdminController, type AdminState } from './controller';
import { createAdminWorkspace } from './api';
import type { AdminScope } from './intent';
export function useAdmin(scope: AdminScope, enabled: boolean) {
  const [controller, setController] = useState<AdminController | null>(null);
  const [state, setState] = useState<AdminState>({
    phase: 'loading',
    data: null,
    canWrite: false,
    canRemove: false,
    actorVerified: false,
    actorRevision: 0,
    busy: false,
    error: null,
    receipt: null,
    referenceId: null,
    canCompare: false,
    issues: [],
  });
  useEffect(() => {
    if (!enabled) return;
    const workspace = createAdminWorkspace(scope);
    setController(workspace.controller);
    setState(workspace.controller.state);
    const unsubscribe = workspace.controller.subscribe(() => setState(workspace.controller.state));
    void workspace.controller.load();
    return () => {
      unsubscribe();
      workspace.dispose();
    };
  }, [scope, enabled]);
  return { controller, state };
}
