'use client';
/**
 * HB-310/HB-311 — trạng thái khung sửa / ngừng dùng chung cho cấu hình giá. Màn hình cung cấp cách dựng
 * bản nháp, kiểm tra, tính thân lệnh (chỉ trường đổi) và gửi `PUT`; hook lo vòng đời: chặn khi lỗi nhập,
 * "chưa có thay đổi", đang gửi, lỗi ghi ngay trong khung, thành công thì đóng khung và tải lại.
 */
import { useState } from 'react';
import { editFailure, reasonIssues, type EditFailure, type EditIssue } from '../lib/config-edit';

export type ConfigEditMode = 'edit' | 'toggle';

export interface ConfigEditState<Item, Draft> {
  item: Item;
  mode: ConfigEditMode;
  draft: Draft;
  issues: readonly EditIssue[];
  failure: EditFailure | null;
  noChange: boolean;
  busy: boolean;
}

export interface ConfigEditSpec<Item, Draft extends { reason: string }, Body> {
  draftOf: (item: Item) => Draft;
  validate: (item: Item, draft: Draft) => readonly EditIssue[];
  toUpdate: (item: Item, draft: Draft) => Body | null;
  toToggle: (item: Item, reason: string) => Body;
  send: (item: Item, body: Body) => Promise<unknown>;
  onSaved: (item: Item, body: Body) => Promise<void>;
}

export function useConfigEdit<Item, Draft extends { reason: string }, Body>(
  spec: ConfigEditSpec<Item, Draft, Body>,
) {
  const [edit, setEdit] = useState<ConfigEditState<Item, Draft> | null>(null);

  const open = (item: Item, mode: ConfigEditMode) =>
    setEdit({
      item,
      mode,
      draft: spec.draftOf(item),
      issues: [],
      failure: null,
      noChange: false,
      busy: false,
    });

  const change = (draft: Draft) =>
    setEdit((current) => (current ? { ...current, draft, noChange: false } : current));

  const submit = async (): Promise<void> => {
    if (!edit || edit.busy) return;
    const { item, draft, mode } = edit;
    const issues = mode === 'edit' ? spec.validate(item, draft) : reasonIssues(draft.reason);
    if (issues.length > 0) {
      setEdit({ ...edit, issues, failure: null });
      return;
    }
    const body = mode === 'edit' ? spec.toUpdate(item, draft) : spec.toToggle(item, draft.reason);
    if (body === null) {
      setEdit({ ...edit, issues: [], failure: null, noChange: true });
      return;
    }
    setEdit({ ...edit, issues: [], failure: null, busy: true });
    try {
      await spec.send(item, body);
    } catch (caught) {
      setEdit((current) =>
        current ? { ...current, busy: false, failure: editFailure(caught) } : current,
      );
      return;
    }
    setEdit(null);
    await spec.onSaved(item, body);
  };

  return { edit, open, change, submit, close: () => setEdit(null) };
}
