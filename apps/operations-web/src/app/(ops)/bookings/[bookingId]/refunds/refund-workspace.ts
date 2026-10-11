'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiClient,
  createAuthApi,
  createBookingApi,
  createPaymentApi,
  createRefundApi,
  isApiError,
  type RefundApi,
} from '@pinehill/api-client';
import type { BookingSummary, BookingBalance, RefundRequest, UserMe } from '@pinehill/contracts';
import type { ScreenState } from '@pinehill/ui-web';
import { createSessionClient } from '@pinehill/web-session/client';
import { readFailureState } from '../../../../../lib/screen-state';
export interface RefundData {
  booking: BookingSummary;
  balance: BookingBalance;
  user: UserMe;
  refunds: RefundRequest[];
}
async function readRefundList(api: RefundApi, bookingId: string): Promise<RefundRequest[]> {
  const result: RefundRequest[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = (await api.list({ bookingId, limit: 100, ...(cursor ? { cursor } : {}) })).data;
    result.push(...page.data);
    if (!page.meta.hasMore) return result;
    const next = page.meta.nextCursor;
    if (!next || cursors.has(next)) throw new Error('Invalid refund pagination');
    cursors.add(next);
    cursor = next;
  }
}
export function useRefundWorkspace(baseUrl: string, bookingId: string, enabled: boolean) {
  const active = useRef(true);
  const denied = useRef(false);
  const epoch = useRef(0);
  const reading = useRef(0);
  const session = useRef<ReturnType<typeof createSessionClient> | null>(null);
  const pinToken = useRef<string | null>(null);
  const [data, setData] = useState<RefundData | null>(null);
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [error, setError] = useState<unknown>(null);
  const [readingNow, setReadingNow] = useState(false);
  const deny = useCallback(() => {
    if (!active.current) return;
    denied.current = true;
    epoch.current++;
    pinToken.current = null;
    setData(null);
    setError(null);
    setReadingNow(false);
    setState({ kind: 'forbidden' });
  }, []);
  const current = useCallback(
    (stamp: number) => active.current && !denied.current && epoch.current === stamp,
    [],
  );
  const version = useCallback(() => epoch.current, []);
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
    return {
      auth: createAuthApi(client),
      bookings: createBookingApi(client),
      payments: createPaymentApi(client),
      refunds: createRefundApi(client),
    };
  }, [baseUrl, deny]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      epoch.current++;
      pinToken.current = null;
      session.current?.dispose();
      session.current = null;
    };
  }, []);
  const protectRead = useCallback(
    <T>(promise: Promise<T>, stamp: number): Promise<T> =>
      promise.catch((caught: unknown) => {
        // A later denial must still hide data after another parallel request has failed.
        if (current(stamp) && isApiError(caught) && readFailureState(caught)) deny();
        throw caught;
      }),
    [current, deny],
  );
  const reload = useCallback(async (): Promise<RefundData | null> => {
    if (denied.current) return null;
    const stamp = epoch.current;
    const sequence = ++reading.current;
    const ownsRead = () => current(stamp) && sequence === reading.current;
    setError(null);
    setReadingNow(true);
    try {
      const [booking, balance, user, refunds] = await Promise.all([
        protectRead(api.bookings.get(bookingId), stamp),
        protectRead(api.payments.balance(bookingId), stamp),
        protectRead(api.auth.me(), stamp),
        protectRead(readRefundList(api.refunds, bookingId), stamp),
      ]);
      if (!ownsRead()) return null;
      const loaded = { booking: booking.data, balance: balance.data, user: user.data, refunds };
      setData(loaded);
      setState({ kind: 'ready' });
      return loaded;
    } catch (caught) {
      if (!ownsRead()) return null;
      if (isApiError(caught) && readFailureState(caught)) deny();
      else {
        setError(caught);
        setState({ kind: 'ready' });
      }
      return null;
    } finally {
      if (ownsRead()) setReadingNow(false);
    }
  }, [api, bookingId, current, deny, protectRead]);
  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload]);
  const replace = useCallback((refund: RefundRequest) => {
    setData((old) =>
      old
        ? {
            ...old,
            refunds: old.refunds.some((value) => value.id === refund.id)
              ? old.refunds.map((value) => (value.id === refund.id ? refund : value))
              : [...old.refunds, refund],
          }
        : null,
    );
  }, []);
  return { api, pinToken, data, state, error, readingNow, reload, replace, deny, current, version };
}
export type RefundWorkspace = ReturnType<typeof useRefundWorkspace>;
