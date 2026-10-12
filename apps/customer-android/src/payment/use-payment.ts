import { useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { createSession } from '../session-factory';
import { secureStorage } from '../storage.native';
import { netInfoSource } from '../netinfo.native';
import { Session } from '../session';
import { PaymentFlow, type PaymentView } from './flow';
import { paymentPorts } from './api';
import { PaymentLifecycle } from './lifecycle';
export function usePayment(bookingId: string) {
  const [view, setView] = useState<PaymentView>({ phase: 'loading', busy: true });
  const [method, setMethod] = useState<'VNPAY' | 'MOMO'>('VNPAY');
  const [handoffFailed, setHandoffFailed] = useState(false);
  const flow = useRef<PaymentFlow | null>(null);
  const lifecycle = useRef<PaymentLifecycle | null>(null);
  const retry = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    let alive = true;
    let hydrated = false;
    const session = createSession();
    const current = new PaymentFlow({
      bookingId,
      ports: paymentPorts(session.apiClient(), bookingId),
      storage: secureStorage(),
      net: netInfoSource(),
      createId: randomUUID,
      now: Date.now,
      changed: (value) => {
        if (!alive) return;
        setView(value);
        lifecycle.current?.sync();
      },
    });
    const timing = new PaymentLifecycle({
      flow: current,
      bookingId,
      now: Date.now,
      schedule: (fn, ms) => {
        const timer = setTimeout(fn, ms);
        return () => clearTimeout(timer);
      },
      cancel: (value) => {
        if (isCancellation(value)) value();
      },
    });
    flow.current = current;
    lifecycle.current = timing;
    const load = async () => {
      try {
        if (!session.hasAccessToken() && !(await session.silentRefresh())) {
          if (alive) setView({ phase: 'expired', busy: false });
          return;
        }
        if (!alive) return;
        hydrated = true;
        await timing.setActive(AppState.currentState === 'active');
        await timing.check();
      } catch (error) {
        if (alive) setView({ phase: Session.isOffline(error) ? 'offline' : 'error', busy: false });
      }
    };
    retry.current = load;
    void load();
    const stateSub = AppState.addEventListener('change', (state) => {
      if (hydrated) void timing.setActive(state === 'active');
    });
    void timing.setActive(AppState.currentState === 'active');
    const linkSub = Linking.addEventListener('url', (event) => {
      if (hydrated) void timing.returnFrom(event.url);
    });
    // Expo Router chooses the booking route; initial query values never establish payment success.
    return () => {
      alive = false;
      stateSub.remove();
      linkSub.remove();
      timing.dispose();
      flow.current = null;
      lifecycle.current = null;
      retry.current = null;
    };
  }, [bookingId]);
  return { view, method, setMethod, handoffFailed, setHandoffFailed, flow, retry };
}

function isCancellation(value: unknown): value is () => void {
  return typeof value === 'function';
}
