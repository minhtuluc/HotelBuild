/** Thành phần hiển thị của SCR-63: thang, bảng xếp hạng (chỉ quản lý), phương án của booking, điều chuyển. */
import type { ReactElement } from 'react';
import { Text, View } from 'react-native';
import type { BookingRelocationOptions, OverbookingCaseDetail, UserMe } from '@pinehill/contracts';
import { color, space } from '@pinehill/ui-native';
import { ActionButton } from '../../arrivals/controls';
import { theme } from '../../theme';
import { f6Text as text } from './messages';
import { androidStep } from './model';
import {
  actionText,
  moveStatusText,
  moveTypeText,
  roomText,
  targetText,
  type PlaceNames,
} from './labels';
import type { MoveState } from './reader';

const card = theme.card;

/** Thang đúng như máy chủ trả; bậc không khả dụng nêu lý do, không giả khả dụng. */
export function Ladder({ steps }: { steps: OverbookingCaseDetail['ladderPreview'] }): ReactElement {
  return (
    <View testID="ladder" style={card}>
      <Text accessibilityRole="header" style={{ fontWeight: '700', color: color.text }}>
        {text('ladderTitle')}
      </Text>
      {steps.map((step) => (
        <Text key={step.step} testID={`ladder-step-${step.step}`} style={{ color: color.text }}>
          {`${text('ladderStep', { step: step.step, type: moveTypeText(step.moveType) })} — ${
            step.feasible
              ? text('stepFeasible', { count: step.candidateCount })
              : text('stepUnavailable', { note: step.note ?? '' })
          }`}
        </Text>
      ))}
    </View>
  );
}

/** Bảng xếp hạng đầy đủ đúng thứ tự máy chủ: không tính lại điểm, không sắp lại, không cắt top-N. */
export function Candidates({ rows }: { rows: OverbookingCaseDetail['candidates'] }): ReactElement {
  return (
    <View testID="candidates" style={{ gap: space.s2 }}>
      <Text accessibilityRole="header" style={{ fontWeight: '700', color: color.text }}>
        {text('candidatesTitle')}
      </Text>
      {rows.map((row) => (
        <View key={row.bookingRoomId} testID={`candidate-${row.rank}`} accessible style={card}>
          <Text style={[{ fontWeight: '600', color: color.text }, theme.tabular]}>
            {text('candidateLine', {
              rank: row.rank,
              name: row.guestNameMasked,
              group: row.priorityGroup,
              total: row.keepScore,
            })}
          </Text>
          <Text style={[theme.muted, theme.tabular]}>
            {text('candidateScore', {
              tier: row.keepScoreBreakdown.loyalty,
              payment: row.keepScoreBreakdown.payment,
              nights: row.keepScoreBreakdown.nights,
              returning: row.keepScoreBreakdown.repeat,
              arrived: row.keepScoreBreakdown.arrived,
            })}
          </Text>
        </View>
      ))}
    </View>
  );
}

type Option = BookingRelocationOptions['options'][number];

function OptionNotes({
  option,
  selectable,
}: {
  option: Option;
  selectable: boolean;
}): ReactElement {
  return (
    <>
      {option.note === undefined ? null : <Text>{text('optionNote', { note: option.note })}</Text>}
      {option.feasible ? null : (
        <Text style={{ color: color.warning }}>{text('optionUnavailable')}</Text>
      )}
      {option.feasible && !selectable ? <Text>{text('optionWeb')}</Text> : null}
    </>
  );
}

function OptionCard(props: {
  option: Option;
  index: number;
  picked: boolean;
  canPick: boolean;
  onPick: (index: number) => void;
  names: PlaceNames;
}): ReactElement {
  const { option } = props;
  const selectable = option.feasible && androidStep(option.moveType);
  return (
    <View testID={`option-${props.index}`} accessible style={card}>
      <Text style={{ fontWeight: '600', color: color.text }}>
        {text('optionLine', {
          type: moveTypeText(option.moveType),
          target: targetText(option, props.names),
        })}
      </Text>
      <Text style={[theme.body, theme.tabular]}>
        {text('optionMoney', { comp: option.compensationAmount, transport: option.transportCost })}
      </Text>
      <Text>{text('optionLocked')}</Text>
      <OptionNotes option={option} selectable={selectable} />
      {selectable && props.canPick ? (
        <ActionButton
          testID={`pick-${props.index}`}
          label={props.picked ? text('picked') : text('pick')}
          tone={props.picked ? 'plain' : 'primary'}
          onPress={() => props.onPick(props.index)}
        />
      ) : null}
    </View>
  );
}

/** Phương án của chính booking đang xử lý: giá giữ nguyên, số tiền nguyên từ máy chủ. */
export function Options(props: {
  view: BookingRelocationOptions;
  picked: number | null;
  canPick: boolean;
  onPick: (index: number) => void;
  names: PlaceNames;
}): ReactElement {
  return (
    <View testID="options" style={{ gap: space.s2 }}>
      <Text accessibilityRole="header" style={{ fontWeight: '700', color: color.text }}>
        {text('optionsTitle')}
      </Text>
      <Text style={{ color: color.textMuted }}>{text('impactBlocked')}</Text>
      {props.view.options.map((option, index) => (
        <OptionCard
          key={`${option.moveType}-${index}`}
          option={option}
          index={index}
          picked={props.picked === index}
          canPick={props.canPick}
          onPick={props.onPick}
          names={props.names}
        />
      ))}
    </View>
  );
}

/** Điều chuyển do máy chủ trả; chỉ `EXECUTED` mới là hoàn tất. */
export function MoveSummary({
  move,
  names,
}: {
  move: MoveState;
  role: UserMe['role'];
  names: PlaceNames;
}): ReactElement {
  const { view } = move;
  return (
    <View testID="move" style={card}>
      <Text accessibilityRole="header" style={{ fontWeight: '700', color: color.text }}>
        {text('moveCreated', {
          type: moveTypeText(view.moveType),
          status: moveStatusText(view.status),
        })}
      </Text>
      <Text>
        {text('moveRooms', {
          from: roomText(view.fromRoomId, names),
          to: roomText(view.toRoomId, names),
        })}
      </Text>
      <Text style={[theme.body, theme.tabular]}>
        {text('optionMoney', { comp: view.compensationAmount, transport: view.transportCost })}
      </Text>
      <Text>{text('optionLocked')}</Text>
      <Text>{view.approvedBy === null ? text('moveNotApproved') : text('moveApproved')}</Text>
      <Text testID="move-final">
        {view.status === 'EXECUTED' ? text('moveExecuted') : text('moveNotExecuted')}
      </Text>
      <Text>{text('actions', { list: actionText(view.allowedActions) })}</Text>
    </View>
  );
}
