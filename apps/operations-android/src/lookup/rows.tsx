import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { color } from '@pinehill/ui-native';
import { lookupText as text, statusText, stayPeriodText, tierText } from './messages';
import { formatVnd, type GuestView, type BookingView } from './view';
import { theme } from '../theme';

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
      style={theme.card}
    >
      <Text accessibilityRole="header" style={{ color: color.text, fontWeight: '600' }}>
        {booking.code} · {statusText(booking.status)}
      </Text>
      <Text style={theme.body}>
        {stayPeriodText(booking.checkIn, booking.checkOut, booking.nights)}
      </Text>
      <Text style={theme.muted}>{text('rooms', { count: booking.roomCount })}</Text>
      <Text style={[theme.body, theme.tabular]}>
        {text('amount', {
          total: formatVnd(booking.totalAmount),
          balance: formatVnd(booking.balanceDue),
        })}
      </Text>
      <Text style={theme.muted}>
        {booking.guestName === null
          ? text('guestUnknown')
          : text('guestOfBooking', { name: booking.guestName })}
      </Text>
      <BlacklistFlag flagged={booking.blacklisted === true} />
      {booking.blacklisted === null ? (
        <Text style={theme.muted}>{text('blacklistUnknown')}</Text>
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
      style={theme.card}
    >
      <Text accessibilityRole="header" style={{ color: color.text, fontWeight: '600' }}>
        {guest.fullName}
      </Text>
      <BlacklistFlag flagged={guest.blacklisted} />
      <Text style={[theme.body, theme.tabular]}>{text('phone', { phone: guest.phone })}</Text>
      {guest.email === null ? null : (
        <Text style={theme.muted}>{text('email', { email: guest.email })}</Text>
      )}
      {guest.history === null ? null : (
        <>
          <Text style={theme.muted}>{text('tier', { tier: tierText(guest.history.tier) })}</Text>
          <Text style={[theme.muted, theme.tabular]}>
            {text('points', { points: guest.history.points })}
          </Text>
          <Text style={[theme.muted, theme.tabular]}>
            {text('stays', { stays: guest.history.totalStays })}
          </Text>
        </>
      )}
      <Pressable
        testID={'lookup-call-' + guest.id}
        accessibilityRole="button"
        accessibilityLabel={text('call')}
        onPress={() => {
          onCall(guest.phone);
        }}
        style={theme.buttonPlain}
      >
        <Text style={theme.buttonPlainText}>{text('call')}</Text>
      </Pressable>
    </View>
  );
}
