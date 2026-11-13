/** SCR-63 — đổi phòng bậc 1–2 (F6, HB-139). Tham số: caseId (bắt buộc), bookingId, bookingRoomId, moveId. */
import { router, useLocalSearchParams } from 'expo-router';
import type { ReactElement } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { color } from '@pinehill/ui-native';
import { f6Deps, useF6Session } from '../../src/features/f6-overbooking/boot.native';
import { f6Text as text } from '../../src/features/f6-overbooking/messages';
import { RelocationScreen } from '../../src/features/f6-overbooking/relocation-screen';
import { theme } from '../../src/theme';

const one = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? '';

export default function RelocationRoute(): ReactElement {
  const params = useLocalSearchParams<{
    caseId?: string;
    bookingId?: string;
    bookingRoomId?: string;
    moveId?: string;
  }>();
  const { phase, session, profile } = useF6Session();
  if (phase === 'boot')
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: color.bg,
        }}
      >
        <ActivityIndicator accessibilityLabel={text('loading')} color={color.primary} />
      </View>
    );
  if (session === null || profile === null)
    return (
      <View style={theme.screen}>
        <Text testID="f6-boot-message" style={theme.body}>
          {text(phase === 'ready' ? 'error' : phase)}
        </Text>
      </View>
    );
  return (
    <RelocationScreen
      session={session}
      profile={profile}
      context={{
        caseId: one(params.caseId),
        bookingId: one(params.bookingId),
        bookingRoomId: one(params.bookingRoomId),
      }}
      moveId={one(params.moveId)}
      online={f6Deps.online}
      createId={f6Deps.createId}
      onBack={() => router.back()}
    />
  );
}
