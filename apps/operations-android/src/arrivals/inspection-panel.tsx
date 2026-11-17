/**
 * HB-251 — khi máy chủ từ chối nhận phòng vì phòng chưa có bằng chứng sẵn sàng (`UNITS_NOT_READY`), lễ tân ghi
 * biên bản đã kiểm phòng (`POST /housekeeping/tasks`, `INSPECTED`, BR-FO-07) cho từng phòng đang chọn rồi xác
 * nhận lại. Không tự gửi lại lệnh nhận phòng: lễ tân quyết định sau khi đã kiểm phòng thật.
 */
import { useState, type ReactElement } from 'react';
import { Text, View } from 'react-native';
import { color, space } from '@pinehill/ui-native';
import { ActionButton } from './controls';
import { arrivalsText as text } from './messages';
import type { CheckInWriter, InspectionOutcome } from './writer';

type Status = 'idle' | 'busy' | 'done' | 'offline' | { failed: string };

function failureCode(outcome: InspectionOutcome): string {
  if (outcome.kind !== 'failed') return '';
  return outcome.failure.kind === 'rejected' ? outcome.failure.code : outcome.failure.kind;
}

export function InspectionPanel({
  writer,
  roomIds,
  roomCodes,
  businessDate,
}: {
  writer: CheckInWriter;
  roomIds: readonly string[];
  roomCodes: string;
  businessDate: string;
}): ReactElement {
  const [status, setStatus] = useState<Status>('idle');

  const record = async (): Promise<void> => {
    setStatus('busy');
    for (const roomId of roomIds) {
      const outcome = await writer.recordInspection({
        roomId,
        businessDate,
        status: 'INSPECTED',
        reason: text('inspectReason'),
      });
      if (outcome.kind === 'offline') return setStatus('offline');
      if (outcome.kind === 'failed') return setStatus({ failed: failureCode(outcome) });
    }
    setStatus('done');
  };

  if (status === 'done')
    return (
      <Text accessibilityLiveRegion="polite" style={{ color: color.success }}>
        {text('inspectDone', { rooms: roomCodes })}
      </Text>
    );
  return (
    <View style={{ gap: space.s2 }}>
      <Text style={{ color: color.text }}>{text('inspectHint')}</Text>
      {status === 'offline' ? (
        <Text accessibilityRole="alert" style={{ color: color.danger }}>
          {text('inspectOffline')}
        </Text>
      ) : null}
      {typeof status === 'object' ? (
        <Text accessibilityRole="alert" style={{ color: color.danger }}>
          {text('inspectFailed', { code: status.failed })}
        </Text>
      ) : null}
      <ActionButton
        testID="check-in-inspect"
        label={status === 'busy' ? text('inspecting') : text('inspect', { rooms: roomCodes })}
        disabled={status === 'busy'}
        tone="plain"
        onPress={() => void record()}
      />
    </View>
  );
}
