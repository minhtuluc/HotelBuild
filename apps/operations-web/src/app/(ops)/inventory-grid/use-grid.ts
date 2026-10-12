import { useEffect, useRef, useState } from 'react';
import { createGridWorkspace } from './api';
import { GridController, type GridState } from './controller';
import { defaultRange } from '../../../lib/inventory-grid';
export function useGrid(enabled: boolean) {
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
    const workspace = createGridWorkspace(initial.current);
    setController(workspace.controller);
    setState(workspace.controller.state);
    const unsubscribe = workspace.controller.subscribe(() => setState(workspace.controller.state));
    void workspace.controller.load('', workspace.controller.state.range);
    return () => {
      unsubscribe();
      workspace.dispose();
    };
  }, [enabled]);
  return { controller, state };
}
