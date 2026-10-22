'use client';
import { useEffect, useRef, useState } from 'react';
import { validateLogin, type FieldIssue, type LoginFailure } from '../../../session/login-model';
import { safeNextPath } from '../../../session/next-path';
import { StaffLoginError, createStaffAuth, type StaffAuth } from '../../../session/staff-auth';

export const FIELD_IDS = { username: 'login-username', password: 'login-password' } as const;

export interface LoginFlow {
  username: string;
  password: string;
  issues: { username?: FieldIssue; password?: FieldIssue };
  failure: LoginFailure | null;
  busy: boolean;
  setUsername(value: string): void;
  setPassword(value: string): void;
  /** Kiểm biểu mẫu rồi gửi nếu hợp lệ; trả các lỗi tìm thấy (rỗng = đã bắt đầu gửi). */
  submit(): LoginFlow['issues'];
}

/** Trạng thái và lời gọi của SCR-14: kiểm biểu mẫu, đăng nhập, về `next` (chỉ đường dẫn nội bộ). */
export function useLoginFlow(rawNext: string | null, goTo: (target: string) => void): LoginFlow {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [issues, setIssues] = useState<LoginFlow['issues']>({});
  const [failure, setFailure] = useState<LoginFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const auth = useRef<StaffAuth | null>(null);
  useEffect(() => {
    auth.current = createStaffAuth();
    return () => {
      auth.current?.dispose();
      auth.current = null;
    };
  }, []);

  const run = async (): Promise<void> => {
    try {
      const active = auth.current;
      if (active === null) throw new StaffLoginError({ kind: 'network' });
      await active.login(username, password);
      goTo(safeNextPath(rawNext));
    } catch (caught) {
      setFailure(caught instanceof StaffLoginError ? caught.failure : { kind: 'network' });
      // Mật khẩu không ở lại trên màn hình sau một lần thất bại; tên đăng nhập giữ để gõ lại nhanh.
      setPassword('');
      setBusy(false);
    }
  };
  return {
    username,
    password,
    issues,
    failure,
    busy,
    setUsername,
    setPassword,
    submit: () => {
      if (busy) return {};
      const found = validateLogin({ username, password });
      setIssues(found);
      setFailure(null);
      if (Object.keys(found).length > 0) return found;
      setBusy(true);
      void run();
      return {};
    },
  };
}
