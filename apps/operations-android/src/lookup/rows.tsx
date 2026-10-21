import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { color, space, touchTargetDp, typography } from '@pinehill/ui-native';
import { lookupText as text, statusText, tierText } from './messages';
import { formatStay, formatVnd, type GuestView, type BookingView } from './view';

function BlacklistFlag({ flagged }: { flagged: boolean }): ReactElement | null {
  if (!flagged) return null;
  return (
    <Text accessibilityLabel={text('blacklist')} style={{ color: color.danger, fontWeight: '700' }}>
      {text('blacklist')}
    </Text>
  );
}

export function BookingCard({ booking }: { booking: BookingView }): ReactElement {
  return (
    <View
      testID={'lookup-booking-' + booking.id}
      accessible
      accessibilityLabel={`${text('bookingGroup')} ${booking.code}, ${statusText(booking.status)}`}
      style={{ gap: space.s2, padding: space.s3, borderWidth: 1, borderRadius: 8 }}
    >
      <Text accessibilityRole="header" style={{ color: color.text, fontWeight: '700' }}>
        {booking.code} · {statusText(booking.status)}
      </Text>
      <Text>{formatStay(booking.checkIn, booking.checkOut, booking.nights)}</Text>
      <Text>{text('rooms', { count: booking.roomCount })}</Text>
      <Text>
        {text('amount', {
          total: formatVnd(booking.totalAmount),
          balance: formatVnd(booking.balanceDue),
        })}
      </Text>
      <Text style={{ color: color.textMuted }}>
        {booking.guestName === null
          ? text('guestUnknown')
          : text('guestOfBooking', { name: booking.guestName })}
      </Text>
      <BlacklistFlag flagged={booking.blacklisted === true} />
      {booking.blacklisted === null ? (
        <Text style={{ color: color.textMuted }}>{text('blacklistUnknown')}</Text>
      ) : null}
    </View>
  );
}

export function GuestCard({
  guest,
  onCall,
}: {
  guest: GuestView;
  onCall: (phone: string) => void;
}): ReactElement {
  return (
    <View
      testID={'lookup-guest-' + guest.id}
      accessible
      accessibilityLabel={`${text('guestGroup')} ${guest.fullName}, ${text('phone', { phone: guest.phone })}`}
      style={{ gap: space.s2, padding: space.s3, borderWidth: 1, borderRadius: 8 }}
    >
      <Text accessibilityRole="header" style={{ color: color.text, fontWeight: '700' }}>
        {guest.fullName}
      </Text>
      <BlacklistFlag flagged={guest.blacklisted} />
      <Text>{text('phone', { phone: guest.phone })}</Text>
      {guest.email === null ? null : <Text>{text('email', { email: guest.email })}</Text>}
      {guest.history === null ? null : (
        <>
          <Text>{text('tier', { tier: tierText(guest.history.tier) })}</Text>
          <Text>{text('points', { points: guest.history.points })}</Text>
          <Text>{text('stays', { stays: guest.history.totalStays })}</Text>
        </>
      )}
      <Pressable
        testID={'lookup-call-' + guest.id}
        accessibilityRole="button"
        accessibilityLabel={text('call')}
        onPress={() => {
          onCall(guest.phone);
        }}
        style={{ minHeight: touchTargetDp, justifyContent: 'center', padding: space.s2 }}
      >
        <Text style={{ color: color.primary, fontSize: typography.body.sp }}>{text('call')}</Text>
      </Pressable>
    </View>
  );
}
