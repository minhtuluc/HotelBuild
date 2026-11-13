/** SCR-67 — cảnh báo quá tải (F6, HB-139). Điểm vào bằng deep link; mở SCR-63 khi bấm Xử lý. */
import { router } from 'expo-router';
import type { ReactElement } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { color } from '@pinehill/ui-native';
import { AlertsScreen } from '../../src/features/f6-overbooking/alerts-screen';
import { alertsCache, f6Deps, useF6Session } from '../../src/features/f6-overbooking/boot.native';
import { f6Text as text } from '../../src/features/f6-overbooking/messages';
import { theme } from '../../src/theme';

export default function AlertsRoute(): ReactElement {
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
    <AlertsScreen
      session={session}
      profile={profile}
      cache={alertsCache}
      online={f6Deps.online}
      createId={f6Deps.createId}
      onBack={() => router.back()}
      onOpen={(caseId, booking) =>
        router.push({
          pathname: '/relocation',
          params: {
            caseId,
            ...(booking === null
              ? {}
              : {
                  bookingId: booking.bookingId,
                  ...(booking.bookingRoomId === null
                    ? {}
                    : { bookingRoomId: booking.bookingRoomId }),
                }),
          },
        })
      }
    />
  );
}
