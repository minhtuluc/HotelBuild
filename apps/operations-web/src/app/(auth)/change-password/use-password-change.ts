'use client';
import { useRef, useState, type RefObject } from 'react';
import {
  passwordChangeFailure,
  validatePasswordChange,
  type FieldIssue,
  type PasswordChangeFailure,
} from '../../../session/login-model';

export type PasswordIssues = { current?: FieldIssue; next?: FieldIssue; confirm?: FieldIssue };
type Field = 'current' | 'next' | 'confirm';

export interface PasswordChange {
  values: Record<Field, string>;
  set(field: Field, value: string): void;
  issues: PasswordIssues;
  failure: PasswordChangeFailure | null;
  busy: boolean;
  refs: Record<Field, RefObject<HTMLInputElement | null>>;
  submit(): void;
}

const ORDER: readonly Field[] = ['current', 'next', 'confirm'];

/** Trạng thái và lời gọi của đổi mật khẩu bắt buộc: kiểm biểu mẫu, gửi đúng một lần, về `next` khi xong. */
export function usePasswordChange(
  send: (input: { currentPassword: string; newPassword: string }) => Promise<void>,
  onDone: () => void,
): PasswordChange {
  const [values, setValues] = useState<Record<Field, string>>({
    current: '',
    next: '',
    confirm: '',
  });
  const [issues, setIssues] = useState<PasswordIssues>({});
  const [failure, setFailure] = useState<PasswordChangeFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const refs = {
    current: useRef<HTMLInputElement>(null),
    next: useRef<HTMLInputElement>(null),
    confirm: useRef<HTMLInputElement>(null),
  };

  const run = async (): Promise<void> => {
    try {
      await send({ currentPassword: values.current, newPassword: values.next });
      onDone();
    } catch (caught) {
      setFailure(passwordChangeFailure(caught));
      // Mật khẩu không ở lại trên màn hình sau một lần thất bại.
      setValues({ current: '', next: '', confirm: '' });
      setBusy(false);
    }
  };
  return {
    values,
    set: (field, value) => {
      setValues((previous) => ({ ...previous, [field]: value }));
    },
    issues,
    failure,
    busy,
    refs,
    submit: () => {
      if (busy) return;
      const found = validatePasswordChange(values);
      setIssues(found);
      setFailure(null);
      const first = ORDER.find((field) => found[field] !== undefined);
      if (first !== undefined) {
        refs[first].current?.focus();
        return;
      }
      setBusy(true);
      void run();
    },
  };
}
