'use client';
import styles from './payment.module.css';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { createSessionClient } from '@pinehill/web-session/client';
import { StateSurface } from '@pinehill/ui-web';
import { paymentPorts } from './payment-api';
import { PaymentFlow, type PaymentView } from './payment-flow';
import { canPoll } from './payment-model';
import { messages as m } from './messages-payment';
import {
  PaymentSummary,
  PaymentForm,
  PaymentDetails,
  paymentSurface,
  type MethodChoice,
} from './payment-panels';
function usePaymentFlow(
  bookingId: string,
  requestedId: string | undefined,
  fixtureOrigin?: string,
) {
  const [view, setView] = useState<PaymentView>({ phase: 'loading', busy: false });
  const [method, setMethod] = useState<MethodChoice>('');
  const [invalid, setInvalid] = useState(false);
  const [visible, setVisible] = useState(true);
  const active = useRef<PaymentFlow | null>(null);
  const reads = useRef(0);
  useEffect(() => {
    const session = createSessionClient({
      kind: 'guest',
      onExpired: () => active.current?.expireSession(),
    });
    const flow = new PaymentFlow({
      ports: paymentPorts(session, bookingId),
      bookingId,
      origin: window.location.origin,
      storage: window.sessionStorage,
      changed: setView,
      ...(fixtureOrigin === undefined ? {} : { fixtureOrigin }),
    });
    active.current = flow;
    reads.current = 0;
    setInvalid(false);
    setMethod('');
    void flow.load(requestedId);
    const visibility = () => setVisible(document.visibilityState === 'visible');
    visibility();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      active.current = null;
      flow.dispose();
      session.dispose();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [bookingId, requestedId, fixtureOrigin]);
  useEffect(() => {
    if (!view.payment || view.busy || !canPoll(view.payment, reads.current, Date.now(), visible))
      return;
    const id = view.payment.paymentId;
    const timer = setTimeout(() => {
      if (document.visibilityState !== 'visible') return;
      reads.current++;
      void active.current?.load(id);
    }, 2000);
    return () => clearTimeout(timer);
  }, [view, visible]);
  const reload = () => void active.current?.load(requestedId ?? view.payment?.paymentId);
  const prepare = () => {
    if (!method) {
      setInvalid(true);
      return;
    }
    void active.current?.prepare(method);
  };
  const choose = (value: 'MOMO' | 'VNPAY') => {
    setMethod(value);
    setInvalid(false);
  };
  async function confirm() {
    const flow = active.current;
    if (!flow) return;
    const url = await flow.confirm();
    if (url && active.current === flow && flow.state.phase === 'pending')
      window.location.assign(url);
  }
  return {
    view,
    method,
    invalid,
    reload,
    prepare,
    choose,
    confirm,
    reference: active.current?.referenceId ?? bookingId,
  };
}
export function PaymentScreen({ fixtureOrigin }: { fixtureOrigin?: string | undefined }) {
  const { bookingId } = useParams<{ bookingId: string }>();
  const requestedId = useSearchParams().get('paymentId') ?? undefined;
  const flow = usePaymentFlow(bookingId, requestedId, fixtureOrigin);
  const { view } = flow;
  return (
    <section
      aria-labelledby="pay-title"
      data-phase={view.phase}
      data-testid="payment-screen"
      className={styles.screen}
    >
      <h1 id="pay-title" style={{ margin: 0 }}>
        {m.title}
      </h1>
      <p style={{ margin: 0 }}>{m.intro}</p>
      <StateSurface state={paymentSurface(view, flow.invalid, flow.reload, flow.reference)} />
      {view.offer ? <PaymentSummary offer={view.offer} /> : null}
      <PaymentForm
        view={view}
        method={flow.method}
        onMethod={flow.choose}
        onPrepare={flow.prepare}
        onConfirm={() => void flow.confirm()}
      />
      <PaymentDetails view={view} fixtureOrigin={fixtureOrigin} />
      {view.phase === 'error' ? <p role="alert">{m.error}</p> : null}
      {view.phase === 'blocked' ? <p>{m.unavailable}</p> : null}
      {view.phase === 'unknown' ? <p>{m.unknown}</p> : null}
      {['pending', 'failed', 'received', 'confirmed', 'error', 'blocked'].includes(view.phase) ? (
        <button type="button" disabled={view.busy} onClick={flow.reload}>
          {m.check}
        </button>
      ) : null}
      <Link href={`/bookings/${encodeURIComponent(bookingId)}`}>{m.back}</Link>
    </section>
  );
}
