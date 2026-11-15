import { useEffect, useRef, useState } from 'react';
import { createGridWorkspace } from './api';
import { GridController, type GridState } from './controller';
import { defaultRange } from '../../../lib/inventory-grid';
/** `workingPropertyId`: đổi cơ sở trên thanh ngữ cảnh thì dựng lại lưới ở cơ sở mới (TD-44). */
export function useGrid(enabled: boolean, workingPropertyId = '') {
  const [controller, setController] = useState<GridController | null>(null);
  const [state, setState] = useState<GridState>(() => ({
    phase: 'loading',
    data: null,
    properties: [],
    propertyId: '',
    range: defaultRange(new Date()),
    error: null,
    busy: false,
  }));
  const initial = useRef(state.range);
  useEffect(() => {
    if (!enabled) return;
    const workspace = createGridWorkspace(initial.current, workingPropertyId);
    setController(workspace.controller);
    setState(workspace.controller.state);
    const unsubscribe = workspace.controller.subscribe(() => setState(workspace.controller.state));
    void workspace.controller.load('', workspace.controller.state.range);
    return () => {
      unsubscribe();
      workspace.dispose();
    };
  }, [enabled, workingPropertyId]);
  return { controller, state };
}
