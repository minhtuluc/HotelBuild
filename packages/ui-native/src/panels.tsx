/**
 * Khung xử lý lỗi và thiếu quyền cho Android (F0-04).
 * Không nhận đối tượng lỗi nên không thể hiện stack trace; chỉ nhận mã tham chiếu.
 */
import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { StateMessageKey } from './stateMessages.js';
import { color, radius, space, touchTargetDp, typography } from './tokens.js';

export type NativeTranslate = (
  key: StateMessageKey,
  vars?: Readonly<Record<string, string | number>>,
) => string;

export interface NativeErrorPanelProps {
  t: NativeTranslate;
  onRetry?: () => void;
  reference?: string | undefined;
}

export function NativeErrorPanel({ t, onRetry, reference }: NativeErrorPanelProps): ReactElement {
  return (
    <View
      accessibilityRole="alert"
      style={{ padding: space.s6, gap: space.s4, backgroundColor: color.bg }}
    >
      <Text style={{ fontSize: typography.h1.sp, fontWeight: '700', color: color.text }}>
        {t('error.boundary.title')}
      </Text>
      <Text style={{ fontSize: typography.body.sp, color: color.text }}>
        {t('error.boundary.body')}
      </Text>
      {reference === undefined ? null : (
        <Text style={{ fontSize: typography.sm.sp, color: color.textMuted }}>{reference}</Text>
      )}
      {onRetry === undefined ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('error.boundary.retry')}
          onPress={onRetry}
          style={{
            minHeight: touchTargetDp,
            justifyContent: 'center',
            paddingHorizontal: space.s3,
            backgroundColor: color.primary,
            borderRadius: radius.md,
            alignSelf: 'flex-start',
          }}
        >
          <Text style={{ color: color.surface, fontWeight: '600' }}>
            {t('error.boundary.retry')}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

export interface NativeAccessDeniedPanelProps {
  t: NativeTranslate;
  onBack?: () => void;
}

export function NativeAccessDeniedPanel({ t, onBack }: NativeAccessDeniedPanelProps): ReactElement {
  return (
    <View accessibilityRole="alert" style={{ padding: space.s6, gap: space.s4 }}>
      <Text style={{ fontSize: typography.h1.sp, fontWeight: '700', color: color.text }}>
        {t('access.denied.title')}
      </Text>
      <Text style={{ fontSize: typography.body.sp, color: color.text }}>
        {t('access.denied.body')}
      </Text>
      {onBack === undefined ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('access.denied.back')}
          onPress={onBack}
          style={{
            minHeight: touchTargetDp,
            justifyContent: 'center',
            paddingHorizontal: space.s3,
            backgroundColor: color.primary,
            borderRadius: radius.md,
            alignSelf: 'flex-start',
          }}
        >
          <Text style={{ color: color.surface, fontWeight: '600' }}>{t('access.denied.back')}</Text>
        </Pressable>
      )}
    </View>
  );
}
