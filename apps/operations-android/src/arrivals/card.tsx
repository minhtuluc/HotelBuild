import type { ReactElement } from 'react';
import { Pressable, Text } from 'react-native';
import type { BookingSummary } from '@pinehill/contracts';
import { color } from '@pinehill/ui-native';
import { statusText, stayPeriodText } from '../lookup/messages';
import { formatVnd } from '../lookup/view';
import { theme } from '../theme';
import { arrivalsText as text } from './messages';

/** Thẻ khách đến: toàn bộ số tiền/trạng thái là số máy chủ trả, không suy ra thêm (ADR-018). */
export function ArrivalCard({
  booking,
  guestName = null,
  onOpen,
}: {
  booking: BookingSummary;
  /** Họ tên đọc theo id (HB-208); `null` khi chưa có/không có — thẻ vẫn hiện bình thường. */
  guestName?: string | null;
  onOpen: (booking: BookingSummary) => void;
}): ReactElement {
  return (
    <Pressable
      testID={'arrival-' + booking.id}
      accessibilityRole="button"
      accessibilityLabel={[
        text('open', { code: booking.code }),
        statusText(booking.status),
        ...(guestName === null ? [] : [guestName]),
      ].join(', ')}
      onPress={() => {
        onOpen(booking);
      }}
      style={[theme.card, { minHeight: 48 }]}
    >
      {guestName === null ? null : (
        <Text
          testID={'arrival-name-' + booking.id}
          style={{ color: color.text, fontWeight: '600' }}
        >
          {guestName}
        </Text>
      )}
      <Text style={{ color: color.text, fontWeight: '600' }}>
        {booking.code} · {statusText(booking.status)}
      </Text>
      <Text style={theme.body}>
        {stayPeriodText(booking.checkIn, booking.checkOut, booking.nights)}
      </Text>
      <Text style={theme.muted}>
        {text('guestsLine', {
          rooms: booking.roomCount,
          adults: booking.adults,
          children: booking.children,
        })}
      </Text>
      <Text style={[theme.muted, theme.tabular]}>
        {text('moneyLine', {
          paid: formatVnd(booking.paidAmount),
          deposit: formatVnd(booking.depositAmount),
          balance: formatVnd(booking.balanceDue),
        })}
      </Text>
      {booking.penaltyAmount > 0 ? (
        <Text style={[theme.alertWarning, theme.tabular]}>
          {text('penaltyLine', { penalty: formatVnd(booking.penaltyAmount) })}
        </Text>
      ) : null}
    </Pressable>
  );
}
