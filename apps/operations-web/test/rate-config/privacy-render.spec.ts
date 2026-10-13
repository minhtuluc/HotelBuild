import { expect, test, vi } from 'vitest';
import { AdminController } from '../../src/app/(ops)/admin-commands/controller';
import { useRateConfig } from '../../src/app/(ops)/rate-plans/use-rate-config';
import type { useAdmin } from '../../src/app/(ops)/admin-commands/use-admin';
import { actor, data } from './fixture';
const runtime = vi.hoisted(() => ({
  model: ((): ReturnType<typeof useAdmin> | null => null)(),
  index: 0,
}));
vi.mock('react', () => ({
  useEffect: () => {},
  useState: () => [runtime.index++ === 0 ? null : 'SYNTHETIC_PRIVATE_SAVED_LABEL', () => {}],
}));
vi.mock('../../src/app/(ops)/admin-commands/use-admin', () => ({ useAdmin: () => runtime.model }));
test.each(['expired', 'forbidden'] as const)(
  'actual hook suppresses saved private label before effects run on %s',
  (phase) => {
    const controller = new AdminController({
      scope: 'rate-config',
      ports: {
        actor: async () => actor,
        read: async () => data,
        write: async () => {
          throw Error('Inactive');
        },
      },
      storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      createId: () => '',
      now: () => 0,
    });
    controller.deny(phase);
    runtime.index = 0;
    runtime.model = { controller, state: controller.state, select: null };
    try {
      expect(useRateConfig(true).saved).toBeNull();
    } finally {
      controller.dispose();
    }
  },
);
