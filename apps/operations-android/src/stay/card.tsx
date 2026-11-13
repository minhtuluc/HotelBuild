import type { ReactElement } from 'react';
import { Pressable, Text } from 'react-native';
import type { BookingSummary } from '@pinehill/contracts';
import { color } from '@pinehill/ui-native';
import { formatBusinessDate } from '../housekeeping/date';
import { formatVnd } from '../lookup/view';
import { stayPeriodText } from '../lookup/messages';
import { theme } from '../theme';
import { stayText as text } from './messages';

/** Thẻ khách đi: số tiền/ngày là số máy chủ trả; "quá hạn" chỉ là so sánh ngày hiển thị, không phải luật. */
export function DepartureCard({
  booking,
  date,
  onOpen,
}: {
  booking: BookingSummary;
  date: string | null;
  onOpen: (booking: BookingSummary) => void;
}): ReactElement {
  const overdue = date !== null && booking.checkOut < date;
  const due = formatBusinessDate(booking.checkOut);
  return (
    <Pressable
      testID={'departure-' + booking.id}
      accessibilityRole="button"
      accessibilityLabel={text('open', { code: booking.code })}
      onPress={() => {
        onOpen(booking);
      }}
      style={[theme.card, overdue ? { borderColor: color.warning } : null]}
    >
      <Text style={{ color: color.text, fontWeight: '600' }}>{booking.code}</Text>
      <Text style={theme.body}>
        {stayPeriodText(booking.checkIn, booking.checkOut, booking.nights)}
      </Text>
      <Text style={overdue ? theme.alertWarning : theme.muted}>
        {text(overdue ? 'overdueLine' : 'dueLine', { date: due })}
      </Text>
      <Text style={[theme.body, theme.tabular]}>
        {text('balanceLine', { balance: formatVnd(booking.balanceDue) })}
      </Text>
    </Pressable>
  );
}
