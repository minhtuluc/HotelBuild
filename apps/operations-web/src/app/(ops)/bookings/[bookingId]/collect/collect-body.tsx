'use client';

import type { ReactElement } from 'react';
import type { BookingBalance, BookingSummary, Payment } from '@pinehill/contracts';
import { CollectForm, PinDialog, Receipt } from './collect-parts';
import {
  suggestedAmount,
  type AmountIssue,
  type CollectMethod,
  type CollectType,
  type PinIssue,
  type PinStep,
} from './collect-model';

export function CollectBody({
  step,
  pin,
  pinIssueValue,
  lockedMinutes,
  wrong,
  unavailable,
  balance,
  booking,
  type,
  method,
  amount,
  note,
  amountIssueValue,
  payment,
  busy,
  onPin,
  onVerify,
  onType,
  onMethod,
  onAmount,
  onNote,
  onSend,
  onPrint,
}: {
  step: PinStep;
  pin: string;
  pinIssueValue: PinIssue | null;
  lockedMinutes: number | null;
  wrong: boolean;
  unavailable: boolean;
  balance: BookingBalance | null;
  booking: BookingSummary | null;
  type: CollectType;
  method: CollectMethod;
  amount: string;
  note: string;
  amountIssueValue: AmountIssue | null;
  payment: Payment | null;
  busy: boolean;
  onPin: (value: string) => void;
  onVerify: () => void;
  onType: (value: CollectType) => void;
  onMethod: (value: CollectMethod) => void;
  onAmount: (value: string) => void;
  onNote: (value: string) => void;
  onSend: () => void;
  onPrint: () => void;
}): ReactElement {
  if (payment !== null) return <Receipt payment={payment} onPrint={onPrint} />;
  const due = booking === null || balance === null ? 0 : suggestedAmount(booking, balance, type);
  return (
    <>
      <PinDialog
        step={step}
        pin={pin}
        issue={pinIssueValue}
        lockedMinutes={lockedMinutes}
        wrong={wrong}
        unavailable={unavailable}
        busy={busy}
        onPin={onPin}
        onSubmit={onVerify}
      />
      {booking === null || balance === null ? null : (
        <CollectForm
          type={type}
          method={method}
          amount={amount}
          suggested={due}
          note={note}
          issue={amountIssueValue}
          pinReady={step === 'verified'}
          busy={busy}
          onType={onType}
          onMethod={onMethod}
          onAmount={onAmount}
          onNote={onNote}
          onSend={onSend}
        />
      )}
    </>
  );
}
