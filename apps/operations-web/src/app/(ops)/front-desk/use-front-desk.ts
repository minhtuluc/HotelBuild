'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApiClient, isApiError } from '@pinehill/api-client';
import { createSessionClient } from '@pinehill/web-session/client';
import { createDeskApi, type DeskApi, type DeskLoad } from './front-desk-api';
import { deskDate } from './front-desk-model';

export interface DeskState {
  readonly phase: 'loading' | 'ready' | 'error' | 'forbidden';
  readonly data: DeskLoad | null;
  readonly error: unknown;
}

export interface FrontDeskSession {
  readonly state: DeskState;
  readonly date: string;
  readonly api: DeskApi;
  /** `pinToken` chỉ sống trong bộ nhớ của màn hình; không lưu, không log (BR-RBAC-05). */
  readonly pinToken: { current: string | null };
  readonly reload: () => void;
  readonly selectProperty: (propertyId: string) => void;
}

/**
 * Phiên + dữ liệu bàn tiền sảnh. Màn hình đọc qua `GET /bookings` của máy chủ (không có endpoint bảng
 * riêng); mọi thao tác ghi vẫn gọi thẳng hợp đồng F7 và máy chủ kiểm quyền/trạng thái lần cuối.
 */
export function useFrontDesk(baseUrl: string, enabled: boolean): FrontDeskSession {
  const params = useSearchParams();
  const date = deskDate(params.get('date'), new Date());
  const session = useRef<ReturnType<typeof createSessionClient> | null>(null);
  const active = useRef(true);
  const denied = useRef(false);
  const epoch = useRef(0);
  const pinToken = useRef<string | null>(null);
  const [state, setState] = useState<DeskState>({ phase: 'loading', data: null, error: null });

  const deny = useCallback(() => {
    denied.current = true;
    epoch.current += 1;
    pinToken.current = null;
    setState({ phase: 'forbidden', data: null, error: null });
  }, []);

  const api = useMemo(() => {
    const client = new ApiClient({
      baseUrl,
      maxAttempts: 2,
      getPinToken: () => pinToken.current,
      getAccessToken: async () => {
        if (!active.current || denied.current) return null;
        session.current ??= createSessionClient({ kind: 'staff', onExpired: deny });
        const token = await session.current.getAccessToken();
        return active.current && !denied.current ? token : null;
      },
    });
    return createDeskApi(client);
  }, [baseUrl, deny]);

  const load = useCallback(
    async (propertyId: string): Promise<void> => {
      if (denied.current) return;
      const ticket = ++epoch.current;
      setState((previous) => ({ ...previous, phase: 'loading', error: null }));
      try {
        const data = await api.load(propertyId, date);
        if (ticket !== epoch.current || denied.current) return;
        setState({ phase: 'ready', data, error: null });
      } catch (caught) {
        if (ticket !== epoch.current || denied.current) return;
        if (isApiError(caught) && (caught.status === 401 || caught.status === 403)) {
          deny();
          return;
        }
        setState((previous) => ({ phase: 'error', data: previous.data, error: caught }));
      }
    },
    [api, date, deny],
  );

  useEffect(() => {
    active.current = true;
    if (enabled) void load('');
    return () => {
      active.current = false;
      epoch.current += 1;
      session.current?.dispose();
      session.current = null;
      pinToken.current = null;
    };
  }, [enabled, load]);

  const reload = useCallback(() => {
    void load(state.data?.propertyId ?? '');
  }, [load, state.data?.propertyId]);

  return {
    state,
    date,
    api,
    pinToken,
    reload,
    selectProperty: (propertyId: string) => {
      void load(propertyId);
    },
  };
}
