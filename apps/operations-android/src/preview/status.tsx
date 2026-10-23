import type { ReactElement } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { color, space } from '@pinehill/ui-native';
import { ActionButton } from '../arrivals/controls';
import { previewText as text } from './messages';
import type { PreviewPhase } from './reader';

const MESSAGE = {
  offline: 'offline',
  expired: 'expired',
  forbidden: 'forbidden',
  error: 'error',
} as const;

/** Trạng thái không-có-số của số xem trước: luôn nói rõ "chưa có số", không bao giờ để trống hay hiện 0. */
export function PreviewStatus({
  phase,
  testID,
  onRetry,
}: {
  phase: PreviewPhase;
  testID: string;
  onRetry: () => void;
}): ReactElement | null {
  if (phase === 'ready' || phase === 'idle') return null;
  if (phase === 'loading')
    return (
      <View style={{ gap: space.s1 }}>
        <ActivityIndicator accessibilityLabel={text('loading')} />
        <Text testID={testID} accessibilityLiveRegion="polite" style={{ color: color.textMuted }}>
          {text('loading')}
        </Text>
      </View>
    );
  return (
    <View style={{ gap: space.s2 }}>
      <Text testID={testID} accessibilityLiveRegion="polite" style={{ color: color.warning }}>
        {text(MESSAGE[phase])}
      </Text>
      <ActionButton
        testID={`${testID}-retry`}
        label={text('retry')}
        tone="plain"
        onPress={onRetry}
      />
    </View>
  );
}
