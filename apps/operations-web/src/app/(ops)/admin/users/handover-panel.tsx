'use client';
import { useState, type ReactElement } from 'react';
import { color, typography } from '@pinehill/ui-web';
import type { Handover } from './controller';
import { userText } from './messages';
import { CONTROL, PANEL } from './styles';

type CopyState = 'idle' | 'copied' | 'failed';

/** Mật khẩu tạm hiện **một lần**; đóng panel là xoá khỏi bộ nhớ (controller.dismissHandover). */
export function HandoverPanel({
  handover,
  onDone,
}: {
  handover: Handover;
  onDone: () => void;
}): ReactElement {
  const [copy, setCopy] = useState<CopyState>('idle');
  const copyPassword = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(handover.password);
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
  };
  return (
    <section aria-labelledby="handover-title" data-testid="handover" style={PANEL}>
      <h2 id="handover-title" style={{ margin: 0, fontSize: typography.h2.web }}>
        {userText('handoverTitle')}
      </h2>
      <p style={{ margin: 0 }}>
        {userText('handoverBody', { username: handover.username, name: handover.fullName })}
      </p>
      <p style={{ margin: 0 }}>
        {userText('handoverPassword')}:{' '}
        <code
          data-testid="handover-password"
          style={{ fontSize: typography.body.web, color: color.text }}
        >
          {handover.password}
        </code>
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          data-testid="handover-copy"
          style={CONTROL}
          onClick={() => void copyPassword()}
        >
          {userText('copy')}
        </button>
        <button type="button" data-testid="handover-done" style={CONTROL} onClick={onDone}>
          {userText('handoverDone')}
        </button>
      </div>
      <p role="status" style={{ margin: 0 }}>
        {copy === 'copied' ? userText('copied') : copy === 'failed' ? userText('copyFailed') : ''}
      </p>
    </section>
  );
}
