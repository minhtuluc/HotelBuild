import { useEffect, useState } from 'react';
import { createAuditWorkspace } from './api';
import type { AuditController, AuditState } from './controller';
import { EMPTY_AUDIT_FILTERS, type AuditFilters } from '../../../lib/audit-log';
const initial: AuditState = {
  phase: 'loading',
  rows: [],
  nextCursor: null,
  filters: EMPTY_AUDIT_FILTERS,
  error: null,
  loadingMore: false,
  updatedAt: null,
};
export function useAudit(filters: AuditFilters, enabled: boolean) {
  const [controller, setController] = useState<AuditController | null>(null);
  const [state, setState] = useState<AuditState>(initial);
  useEffect(() => {
    if (!enabled) return;
    const workspace = createAuditWorkspace();
    setController(workspace.controller);
    setState(workspace.controller.state);
    const unsubscribe = workspace.controller.subscribe(() => setState(workspace.controller.state));
    return () => {
      unsubscribe();
      workspace.dispose();
    };
  }, [enabled]);
  useEffect(() => {
    if (enabled && controller) void controller.load(filters);
  }, [controller, enabled, filters]);
  return { controller, state };
}
