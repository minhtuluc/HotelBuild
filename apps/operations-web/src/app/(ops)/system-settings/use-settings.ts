import { useEffect, useState } from 'react';
import { createSettingsWorkspace } from './api';
import { SettingsController } from './controller';
export function useSettings(enabled: boolean) {
  const [controller, setController] = useState<SettingsController | null>(null);
  const [state, setState] = useState(
    () =>
      new SettingsController({
        ports: {
          actor: async () => {
            throw Error('Inactive');
          },
          list: async () => [],
          write: async () => {},
        },
        storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        createId: () => '',
        now: () => 0,
      }).state,
  );
  useEffect(() => {
    if (!enabled) return;
    const workspace = createSettingsWorkspace();
    setController(workspace.controller);
    setState(workspace.controller.state);
    const unsubscribe = workspace.controller.subscribe(() => setState(workspace.controller.state));
    void workspace.controller.load();
    return () => {
      unsubscribe();
      workspace.dispose();
    };
  }, [enabled]);
  return { controller, state };
}
