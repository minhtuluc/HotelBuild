'use client';

/**
 * Cổng phiên của khu vực nhân viên (SCR-14): hồ sơ `GET /auth/me` → đổi mật khẩu bắt buộc → cơ sở đang làm
 * việc → vào màn hình. Chuyển hướng theo `decideGate` (hàm thuần, đã có test). Phiên hết hạn hoặc nhàn rỗi
 * 15 phút ⇒ thu hồi phiên rồi về `/login?next=…` (máy chủ vẫn là nguồn quyết định; đây là hành vi phía client).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isApiError, type ApiClient } from '@pinehill/api-client';
import type { UserMe } from '@pinehill/contracts';
import { useOpsSession } from '../lib/ops-session';
import { changePassword, loadProfile, loadProperties, propertiesForGate } from './api';
import { decideGate, grantedProperties, type GateStage, type PropertyOption } from './gate';
import { createIdleWatcher } from './idle';
import { gateUrl, loginUrl, type LoginReason } from './next-path';
import { createStaffAuth, type StaffAuth } from './staff-auth';
import {
  clearStoredProperty,
  readStoredProperty,
  storeProperty,
  type PropertyStorage,
} from './working-property';

export type GatePhase =
  | { kind: 'checking' }
  | { kind: 'error' }
  | { kind: 'none' }
  | {
      kind: 'ready';
      me: UserMe;
      properties: readonly PropertyOption[];
      propertyId: string | null;
    };

export interface StaffGate {
  phase: GatePhase;
  /** Client phiên (BFF `/api/session/sys`) cho các lời gọi của chính cổng này. */
  client: ApiClient;
  retry(): void;
  selectProperty(propertyId: string): void;
  changePassword(input: { currentPassword: string; newPassword: string }): Promise<void>;
  logout(): Promise<void>;
}

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart'] as const;

function tabStorage(): PropertyStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function redirectTarget(to: 'login' | 'change-password' | 'select-property'): string {
  const next = currentPath();
  if (to === 'login') return loginUrl(next);
  return to === 'change-password'
    ? gateUrl('/change-password', next)
    : gateUrl('/select-property', next);
}

export function useStaffGate(stage: GateStage): StaffGate {
  const router = useRouter();
  const [phase, setPhase] = useState<GatePhase>({ kind: 'checking' });
  const [attempt, setAttempt] = useState(0);
  const auth = useRef<StaffAuth | null>(null);
  const leaving = useRef(false);
  /** Trước khi cổng qua được lần đầu, 401 là "chưa đăng nhập" (không phải "phiên hết hạn"). */
  const admitted = useRef(false);

  const leave = useCallback(
    (reason?: LoginReason): Promise<void> => {
      if (leaving.current) return Promise.resolve();
      leaving.current = true;
      clearStoredProperty(tabStorage());
      const target = reason === undefined ? '/login' : loginUrl(currentPath(), reason);
      const active = auth.current;
      return (active === null ? Promise.resolve() : active.logout()).finally(() => {
        router.replace(target);
      });
    },
    [router],
  );
  const onExpired = useCallback(() => {
    if (admitted.current) void leave('expired');
  }, [leave]);
  const ops = useOpsSession(['/auth', '/properties'], { onExpired });

  useEffect(() => {
    leaving.current = false;
    const created = createStaffAuth({ onExpired });
    auth.current = created;
    const onLegacyExpiry = (): void => {
      if (admitted.current) void leave('expired');
    };
    window.addEventListener('session-expired', onLegacyExpiry);
    return () => {
      window.removeEventListener('session-expired', onLegacyExpiry);
      created.dispose();
      auth.current = null;
    };
  }, [leave, onExpired]);

  useEffect(() => {
    let cancelled = false;
    const fail = (error: unknown): void => {
      if (cancelled) return;
      if (isApiError(error) && error.status === 401) {
        leaving.current = true;
        router.replace(loginUrl(currentPath()));
        return;
      }
      if (isApiError(error) && error.code === 'E_AUTH_PASSWORD_CHANGE_REQUIRED') {
        router.replace(gateUrl('/change-password', currentPath()));
        return;
      }
      setPhase({ kind: 'error' });
    };
    const run = async (): Promise<void> => {
      setPhase({ kind: 'checking' });
      const me = await loadProfile(ops.client);
      const properties =
        stage === 'change-password' ? null : await propertiesForGate(ops.client, me);
      if (cancelled) return;
      const outcome = decideGate({
        stage,
        me,
        properties,
        stored: readStoredProperty(tabStorage()),
      });
      if (outcome.kind === 'redirect') {
        router.replace(redirectTarget(outcome.to));
        return;
      }
      if (outcome.kind === 'none') {
        admitted.current = true;
        setPhase({ kind: 'none' });
        return;
      }
      if (outcome.propertyId !== null) storeProperty(tabStorage(), outcome.propertyId);
      admitted.current = true;
      setPhase({
        kind: 'ready',
        me,
        properties: grantedProperties(me, properties),
        propertyId: outcome.propertyId,
      });
      if (properties === null && stage === 'app') enrichNames(me);
    };
    // Tên cơ sở chỉ để hiển thị: tải ngầm một lần, lỗi thì giữ mã cơ sở (không chặn, không báo lỗi).
    const enrichNames = (me: UserMe): void => {
      loadProperties(ops.client).then(
        (list) => {
          if (cancelled) return;
          setPhase((previous) =>
            previous.kind === 'ready'
              ? { ...previous, properties: grantedProperties(me, list) }
              : previous,
          );
        },
        () => undefined,
      );
    };
    run().catch(fail);
    return () => {
      cancelled = true;
    };
  }, [attempt, ops, router, stage]);

  const ready = phase.kind === 'ready' || phase.kind === 'none';
  useEffect(() => {
    if (!ready) return;
    const watcher = createIdleWatcher({
      onIdle: () => {
        void leave('expired');
      },
    });
    const touch = (): void => watcher.touch();
    const visible = (): void => {
      if (document.visibilityState === 'visible') watcher.check();
    };
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, touch, { passive: true });
    document.addEventListener('visibilitychange', visible);
    watcher.start();
    return () => {
      watcher.stop();
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, touch);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [ready, leave]);

  const selectProperty = useCallback((propertyId: string) => {
    setPhase((previous) => {
      if (previous.kind !== 'ready' || !previous.properties.some((p) => p.id === propertyId))
        return previous;
      storeProperty(tabStorage(), propertyId);
      return { ...previous, propertyId };
    });
  }, []);

  return {
    phase,
    client: ops.client,
    retry: () => setAttempt((value) => value + 1),
    selectProperty,
    changePassword: (input) => changePassword(ops.client, input),
    logout: () => leave(),
  };
}
