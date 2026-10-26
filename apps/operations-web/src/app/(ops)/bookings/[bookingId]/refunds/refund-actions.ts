'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isApiError } from '@pinehill/api-client';
import { t } from '../../../../../lib/i18n';
import type { RefundRequest, PinToken } from '@pinehill/contracts';
import type { ScreenState } from '@pinehill/ui-web';
import { writeFailureState, readFailureState } from '../../../../../lib/screen-state';
import { pinIssue, pinGrantValid, pinFailure, type PinStep } from '../collect/collect-model';
import { paidEvidence, type RefundAction } from './refund-model';
import { claimPayout, pendingPayout } from './payout-barrier';
import type { RefundWorkspace } from './refund-workspace';
import {
  intentIssue,
  firstPayment,
  requiresPin,
  canCommand,
  commandResolved,
  executeRefund,
  isRefundPayoutView,
  transferFailure,
} from './refund-command';
export interface RefundIntent {
  action: RefundAction | 'create';
  target: RefundRequest | null;
}
const interactionBlocked = (
  sending: boolean,
  verifying: boolean,
  unknown: RefundIntent | null,
  reading: boolean,
  step: PinStep,
): boolean => sending || verifying || unknown !== null || reading || step === 'locked';
export function useRefundActions(workspace: RefundWorkspace) {
  const { api, current, version, deny, pinToken, replace, reload } = workspace;
  const sending = useRef(false);
  const verifying = useRef(false);
  const grant = useRef<PinToken | null>(null);
  const unknown = useRef<RefundIntent | null>(null);
  const [intent, setIntent] = useState<RefundIntent | null>(null);
  const [step, setStep] = useState<PinStep>('idle');
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [lockedMinutes, setLockedMinutes] = useState<number | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [bankReference, setBankReference] = useState('');
  const [paymentId, setPaymentId] = useState('');
  const [recipient, setRecipient] = useState(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<ScreenState | null>(null);
  const [checkedData, setCheckedData] = useState<RefundWorkspace['data']>(null);
  const barrierReady = workspace.data === checkedData;
  const lookupRef = useRef<() => Promise<void>>(async () => undefined);
  const clearGrant = useCallback(() => {
    grant.current = null;
    pinToken.current = null;
    setPin('');
    setExpiresAt(null);
    setStep((old) => (old === 'locked' ? old : 'idle'));
  }, [pinToken]);
  const showPending = useCallback(
    (pending: RefundIntent) => {
      clearGrant();
      unknown.current = pending;
      setIntent(null);
      setState({
        kind: 'unknownOutcome',
        referenceId: pending.target?.id ?? '—',
        onLookup: () => void lookupRef.current(),
      });
    },
    [clearGrant],
  );
  useEffect(() => {
    const data = workspace.data;
    if (!data) return;
    let live = true;
    const stamp = version();
    void pendingPayout(data.refunds)
      .then((pending) => {
        if (!live || !current(stamp)) return;
        setCheckedData(data);
        if (pending) showPending({ action: 'pay', target: pending });
      })
      .catch(() => {
        if (live && current(stamp))
          setState({
            kind: 'validationError',
            details: [
              {
                field: t('ops.refunds.field.payout'),
                issue: t('ops.refunds.guardUnavailable'),
              },
            ],
          });
      });
    return () => {
      live = false;
    };
  }, [workspace.data, version, current, showPending]);
  useEffect(() => {
    if (expiresAt === null) return;
    const timer = window.setTimeout(clearGrant, Math.max(0, Date.parse(expiresAt) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [clearGrant, expiresAt]);
  const hidden = workspace.state.kind === 'forbidden';
  useEffect(() => {
    if (hidden) {
      clearGrant();
      setIntent(null);
      setNote('');
      setBankReference('');
      setAmount('');
      setPaymentId('');
      setRecipient(false);
      setState(null);
    }
  }, [clearGrant, hidden]);
  const reset = () => {
    if (sending.current || verifying.current || unknown.current) return;
    clearGrant();
    setIntent(null);
    setNote('');
    setBankReference('');
    setRecipient(false);
    setState(null);
  };
  const begin = (next: RefundIntent) => {
    if (
      !barrierReady ||
      interactionBlocked(
        sending.current,
        verifying.current,
        unknown.current,
        workspace.readingNow,
        step,
      )
    )
      return;
    clearGrant();
    setWrong(false);
    setUnavailable(false);
    setIntent(next);
    setState(null);
    setAmount(String(next.target?.requestedAmount ?? ''));
    setNote('');
    setBankReference('');
    setRecipient(false);
    setPaymentId(firstPayment(workspace.data));
  };
  const handlePinFailure = (caught: unknown) => {
    const failure = pinFailure(caught, isApiError);
    if (failure.locked) {
      setStep('locked');
      setLockedMinutes(
        failure.retryAfterSeconds === null ? null : Math.ceil(failure.retryAfterSeconds / 60),
      );
    } else if (
      isApiError(caught) &&
      ['E_AUTH_PIN_REQUIRED', 'E_AUTH_INVALID_CREDENTIALS'].includes(caught.code ?? '')
    ) {
      setStep('idle');
      setWrong(true);
    } else if (isApiError(caught) && readFailureState(caught)) deny();
    else {
      setStep('idle');
      setUnavailable(true);
    }
  };
  const verify = async () => {
    if (
      !intent ||
      !workspace.data ||
      interactionBlocked(sending.current, verifying.current, unknown.current, false, step) ||
      pinIssue(pin)
    )
      return;
    const stamp = version();
    verifying.current = true;
    setBusy(true);
    setStep('verifying');
    setWrong(false);
    setUnavailable(false);
    try {
      const token = (await api.auth.pinVerify(pin, workspace.data.booking.id)).data;
      if (!current(stamp)) return;
      if (!pinGrantValid(token, Date.now())) {
        clearGrant();
        return;
      }
      grant.current = token;
      pinToken.current = token.pinToken;
      setExpiresAt(token.expiresAt);
      setStep('verified');
    } catch (caught) {
      if (current(stamp)) handlePinFailure(caught);
    } finally {
      verifying.current = false;
      if (current(stamp)) {
        setPin('');
        setBusy(false);
      }
    }
  };
  const issue = intentIssue(intent, amount, note, recipient, bankReference);
  const lookup = async () => {
    const pending = unknown.current;
    if (!pending) return;
    const stamp = version();
    const loaded = await reload();
    if (!current(stamp) || !loaded) return;
    const found = loaded.refunds.find((value) => value.id === pending.target?.id);
    if (found && commandResolved(pending, found, loaded.user.userId, amount)) {
      if (!current(stamp)) return;
      unknown.current = null;
      setIntent(null);
      setNote('');
      setState({ kind: 'success' });
    }
  };
  lookupRef.current = lookup;
  const handleWriteFailure = (caught: unknown, pending: RefundIntent) => {
    if (isApiError(caught) && caught.code === 'E_AUTH_PIN_REQUIRED') {
      setWrong(true);
      setState(null);
      return;
    }
    // HB-215: 400/409/422 của lệnh xác nhận chuyển khoản hiện **nguyên văn** câu của máy chủ.
    const verbatim =
      pending.action === 'confirm-transfer' && isApiError(caught) ? transferFailure(caught) : null;
    if (verbatim !== null) {
      setState(verbatim);
      return;
    }
    const failure = writeFailureState(caught, {
      attemptedVersion: '—',
      onReload: () => {
        reset();
        void reload();
      },
      onLookup: () => void lookup(),
    });
    if (failure.kind === 'forbidden') deny();
    else {
      if (failure.kind === 'unknownOutcome') unknown.current = pending;
      setState(failure);
    }
  };
  const settleResult = (result: RefundRequest, pending: RefundIntent) => {
    replace(result);
    clearGrant();
    setIntent(null);
    setNote('');
    setBankReference('');
    if (pending.action === 'pay' && !paidEvidence(result)) {
      unknown.current = pending;
      setState({ kind: 'unknownOutcome', referenceId: result.id, onLookup: () => void lookup() });
    } else setState({ kind: 'success' });
  };
  /**
   * Máy chủ đã nhận lệnh xác nhận chuyển khoản: **không tự suy `PAID`** — đọc lại hồ sơ, chỉ báo
   * thành công khi máy chủ trả `PAID`; ngược lại giữ trạng thái "chưa xác định" để tra cứu.
   */
  const settleTransfer = async (pending: RefundIntent, stamp: number) => {
    clearGrant();
    setIntent(null);
    setNote('');
    setBankReference('');
    const loaded = await reload();
    if (!current(stamp) || loaded === null) return;
    const found = loaded.refunds.find((value) => value.id === pending.target?.id);
    if (found !== undefined && found.status === 'PAID') {
      setState({ kind: 'success' });
      return;
    }
    unknown.current = pending;
    setState({
      kind: 'unknownOutcome',
      referenceId: pending.target?.id ?? '—',
      onLookup: () => void lookupRef.current(),
    });
  };
  const grantReady = (pending: RefundIntent) =>
    !requiresPin(pending) || pinGrantValid(grant.current, Date.now());
  const endSend = (stamp: number) => {
    sending.current = false;
    if (current(stamp)) {
      clearGrant();
      setBusy(false);
    }
  };
  const readyIntent = (): RefundIntent | null => {
    const data = workspace.data;
    if (!intent || !data || !barrierReady || issue !== null) return null;
    if (
      interactionBlocked(
        sending.current,
        verifying.current,
        unknown.current,
        workspace.readingNow,
        step,
      )
    )
      return null;
    if (!grantReady(intent)) {
      clearGrant();
      return null;
    }
    return canCommand(intent, data) ? intent : null;
  };
  const preparePayout = async (pending: RefundIntent, stamp: number): Promise<string | null> => {
    if (pending.action !== 'pay') return '';
    const payout = await claimPayout(pending.target!.id);
    if (!current(stamp)) return null;
    if (!payout.claimed || !grantReady(pending)) {
      showPending(pending);
      return null;
    }
    return payout.key;
  };
  const performSend = async (pending: RefundIntent, stamp: number) => {
    const payoutKey = await preparePayout(pending, stamp);
    if (payoutKey === null || !current(stamp)) return;
    const result = await executeRefund(workspace, pending, {
      amount,
      note,
      paymentId,
      payoutKey,
      bankReference,
    });
    if (!current(stamp)) return;
    if (isRefundPayoutView(result)) {
      await settleTransfer(pending, stamp);
      return;
    }
    settleResult(result, pending);
    await reload();
  };
  const sendFailure = (caught: unknown, pending: RefundIntent) => {
    if (pending.action !== 'pay') handleWriteFailure(caught, pending);
    else if (isApiError(caught) && readFailureState(caught)) deny();
    else showPending(pending);
  };
  const send = async () => {
    const pending = readyIntent();
    if (!pending) return;
    const stamp = version();
    sending.current = true;
    setBusy(true);
    setState(null);
    try {
      await performSend(pending, stamp);
    } catch (caught) {
      if (current(stamp)) sendFailure(caught, pending);
    } finally {
      endSend(stamp);
    }
  };
  return {
    intent,
    begin,
    reset,
    step,
    pin,
    setPin,
    wrong,
    unavailable,
    lockedMinutes,
    verify,
    amount,
    setAmount,
    note,
    setNote,
    bankReference,
    setBankReference,
    paymentId,
    setPaymentId,
    recipient,
    setRecipient,
    issue,
    busy,
    state,
    send,
    blocked:
      !barrierReady ||
      busy ||
      workspace.readingNow ||
      state?.kind === 'unknownOutcome' ||
      step === 'locked',
  };
}
export type RefundControls = ReturnType<typeof useRefundActions>;
