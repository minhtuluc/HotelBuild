import type { ReactElement } from 'react';
import { Pressable, Text } from 'react-native';
import type { BookingSummary } from '@pinehill/contracts';
import { color, space, touchTargetDp } from '@pinehill/ui-native';
import { formatBusinessDate } from '../housekeeping/date';
import { formatStay, formatVnd } from '../lookup/view';
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
      style={{
        minHeight: touchTargetDp,
        gap: space.s2,
        padding: space.s3,
        borderWidth: 1,
        borderRadius: 8,
        borderColor: overdue ? color.warning : color.border,
      }}
    >
      <Text style={{ color: color.text, fontWeight: '700' }}>{booking.code}</Text>
      <Text>{formatStay(booking.checkIn, booking.checkOut, booking.nights)}</Text>
      <Text style={overdue ? { color: color.warning } : undefined}>
        {text(overdue ? 'overdueLine' : 'dueLine', { date: due })}
      </Text>
      <Text>{text('balanceLine', { balance: formatVnd(booking.balanceDue) })}</Text>
    </Pressable>
  );
}
