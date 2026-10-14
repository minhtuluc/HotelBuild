'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { defaultRange } from '../../../lib/inventory-grid';
import { changedItems, validateDrafts } from '../../../lib/allotments';
import { FORM_WIDE_FIELD } from '../../../lib/screen-state';
import { useAdmin } from '../admin-commands/use-admin';
import { selectionKey, visibleEditor, displayRows, sellingUnits, type Editor } from './editor';
export function useAllotments(enabled: boolean) {
  const [initial] = useState(() => ({ range: defaultRange(new Date()) }));
  const model = useAdmin('allotment', enabled, initial);
  const { state, controller } = model;
  const [editor, setEditor] = useState<Editor | null>(null);
  const current = state.data?.allotment;
  const key = selectionKey(current);
  const visible = visibleEditor(state, editor, key);
  const rows = displayRows(current, visible);
  const units = sellingUnits(state, current);
  useEffect(() => {
    setEditor(null);
  }, [state.actorRevision]);
  useEffect(() => {
    if (state.phase === 'expired' || state.phase === 'forbidden') setEditor(null);
  }, [state.phase]);
  useEffect(() => {
    if (state.receipt?.kind === 'allotment-put') setEditor(null);
  }, [state.receipt]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!current || !controller?.canStart()) return;
    const issues = validateDrafts(rows, units, current.range);
    if (issues.length) {
      controller.validation(issues);
      return;
    }
    const items = changedItems(rows);
    if (!items.length) {
      controller.validation([{ field: FORM_WIDE_FIELD, issue: 'UNCHANGED' }]);
      return;
    }
    await controller.save({
      kind: 'allotment-put',
      tag: current.tag,
      range: current.range,
      body: { channelId: current.channelId, roomTypeId: current.roomTypeId, items: [...items] },
    });
  };
  const adopt = () => {
    if (!current || !state.canCompare || state.busy) return;
    setEditor({
      key,
      revision: state.actorRevision,
      tag: current.tag,
      rows: rows.map((row) => ({
        ...row,
        original: current.rows.find((item) => item.date === row.date)?.allotment,
      })),
    });
    controller?.adoptVersion();
  };
  const change = (index: number, value: string) => {
    if (!current) return;
    controller?.clearValidation();
    setEditor({
      key,
      revision: state.actorRevision,
      tag: visible?.tag ?? current.tag,
      rows: rows.map((row, i) => (i === index ? { ...row, value } : row)),
    });
  };
  return {
    ...model,
    current,
    key,
    visible,
    rows,
    sellingUnits: units,
    submit,
    adopt,
    change,
    clearEditor: () => setEditor(null),
  };
}
