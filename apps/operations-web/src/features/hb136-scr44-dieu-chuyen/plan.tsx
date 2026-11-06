'use client';
import { useState, type ReactElement } from 'react';
import { formatDateTimeVn } from '@pinehill/ui-web';
import type { RelocationPlan } from '@pinehill/contracts';
import { text } from './messages';
import { ConfirmDialog, SelectInput, box } from './parts';

/** Lập phương án (MANAGER/OWNER): kết quả là phương án máy chủ trả, chưa gán phòng. */
export function PlanPanel(props: {
  plan: RelocationPlan | null;
  busy: boolean;
  onPlan: (strategy: 'AUTO' | 'MANUAL') => void;
}): ReactElement {
  const [strategy, setStrategy] = useState<'AUTO' | 'MANUAL'>('AUTO');
  const [asking, setAsking] = useState(false);
  return (
    <section style={box} aria-labelledby="hb136-plan-title" data-testid="hb136-plan">
      <h2 id="hb136-plan-title">{text('planTitle')}</h2>
      <SelectInput
        name="strategy"
        label={text('planStrategy')}
        value={strategy}
        options={[
          { id: 'AUTO', label: text('auto') },
          { id: 'MANUAL', label: text('manual') },
        ]}
        onChange={(value) => setStrategy(value === 'MANUAL' ? 'MANUAL' : 'AUTO')}
      />
      <button
        type="button"
        disabled={props.busy}
        onClick={() => setAsking(true)}
        style={{ minHeight: 44, justifySelf: 'start' }}
        data-testid="hb136-plan-submit"
      >
        {text('planGo')}
      </button>
      {props.plan === null ? null : (
        <p role="status">{text('planDone', { time: formatDateTimeVn(props.plan.generatedAt) })}</p>
      )}
      <ConfirmDialog
        id="hb136-dialog-plan"
        open={asking}
        title={text('planTitle')}
        confirmLabel={text('confirm')}
        cancelLabel={text('cancel')}
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          props.onPlan(strategy);
        }}
      >
        <p>{strategy === 'AUTO' ? text('auto') : text('manual')}</p>
      </ConfirmDialog>
    </section>
  );
}
