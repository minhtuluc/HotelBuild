/**
 * Mở phiên cho tuyến F6 (deep link): dùng refresh token trong secure storage do module auth quản lý để lấy
 * phiên mới ngay (không lưu thêm gì ở F6) rồi đọc hồ sơ để biết vai/phạm vi. Chỉ import từ gốc tuyến.
 */
import { useEffect, useState } from 'react';
import { randomUUID } from 'expo-crypto';
import type { UserMe } from '@pinehill/contracts';
import { netInfoSource } from '../../netinfo.native';
import { OfflineError } from '../../netinfo';
import type { Session } from '../../session';
import { createSession } from '../../session-factory';
import { AlertsCache } from './reader';

export type BootPhase = 'boot' | 'ready' | 'expired' | 'offline' | 'error';

export interface Booted {
  readonly phase: BootPhase;
  readonly session: Session | null;
  readonly profile: UserMe | null;
}

const BOOTING: Booted = { phase: 'boot', session: null, profile: null };

export const f6Deps = {
  online: () => netInfoSource().getConnected(),
  createId: () => randomUUID(),
};

/** Cache RAM của SCR-67; mất cùng tiến trình, không ghi đĩa. */
export const alertsCache = new AlertsCache();

async function open(session: Session): Promise<Booted> {
  if (!(await session.silentRefresh())) return { phase: 'expired', session: null, profile: null };
  const profile = await session.profile();
  const only = profile.propertyScope.length === 1 ? profile.propertyScope[0] : undefined;
  if (only !== undefined) session.selectProperty(only);
  return { phase: 'ready', session, profile };
}

export function useF6Session(): Booted {
  const [booted, setBooted] = useState<Booted>(BOOTING);
  useEffect(() => {
    let live = true;
    const session = createSession();
    void open(session)
      .catch((error: unknown): Booted => ({
        phase: error instanceof OfflineError ? 'offline' : 'error',
        session: null,
        profile: null,
      }))
      .then((next) => {
        if (live) setBooted(next);
      });
    return () => {
      live = false;
      alertsCache.clear();
    };
  }, []);
  return booted;
}
