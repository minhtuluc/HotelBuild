/**
 * HB-272 — hàm style thuần cho thành phần "vé tàu" (DESIGN.md §Components), tách khỏi component để test
 * trong node không cần renderer. Không có bóng trừ vật thể giấy; không làm mờ nút bằng opacity.
 */
import type { TextStyle, ViewStyle } from 'react-native';
import {
  color,
  fontFamily,
  radius,
  space,
  touchTargetDp,
  typography,
  worldInk,
} from '../tokens.js';

export type ButtonRole = 'accent' | 'primary' | 'outline' | 'danger';
export type ButtonSize = 'md' | 'lg';

export interface ButtonStyleInput {
  readonly role: ButtonRole;
  readonly size?: ButtonSize;
  readonly disabled?: boolean;
  readonly pressed?: boolean;
  /** Nằm trên giấy vé hồng: đỏ hành động đổi sang đỏ đậm (The Ticket Ink Rule). */
  readonly onTicket?: boolean;
}

interface Ink {
  readonly background: string;
  readonly border: string;
  readonly text: string;
}

function roleInk(role: ButtonRole, onTicket: boolean): Ink {
  switch (role) {
    case 'accent': {
      const punch = onTicket ? worldInk.ticketPunch : worldInk.punch;
      return { background: punch, border: punch, text: color.accentContrast };
    }
    case 'primary':
      return { background: color.primary, border: color.primary, text: color.primaryContrast };
    case 'outline':
      return { background: 'transparent', border: color.borderStrong, text: color.text };
    case 'danger':
      return { background: 'transparent', border: color.danger, text: color.danger };
  }
}

const DISABLED: Ink = {
  background: color.surfaceMuted,
  border: color.border,
  text: color.textMuted,
};

export function buttonStyle(input: ButtonStyleInput): { container: ViewStyle; label: TextStyle } {
  const large = input.size === 'lg';
  const ink = input.disabled === true ? DISABLED : roleInk(input.role, input.onTicket === true);
  return {
    container: {
      minHeight: large ? 56 : touchTargetDp,
      paddingHorizontal: large ? 26 : 18,
      paddingVertical: large ? space.s3 : 10,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: ink.border,
      backgroundColor: ink.background,
      justifyContent: 'center',
      alignItems: 'center',
      ...(input.pressed === true ? { transform: [{ translateY: 1 }] } : {}),
    },
    label: {
      color: ink.text,
      fontFamily: fontFamily.sansSemiBold,
      fontSize: large ? typography.body.sp : typography.sm.sp + 1,
      textAlign: 'center',
    },
  };
}

/** Thẻ giấy in: viền mảnh, bo 6, không bóng (The Paper Only Rule). */
export function paperStyle(): ViewStyle {
  return {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    padding: space.s4,
    gap: space.s2,
  };
}

/** Giấy vé hồng, đầu kẻ đôi 3dp mực xanh; vật thể giấy nên có bóng "vé trên bàn". */
export function ticketStyle(): ViewStyle {
  return {
    backgroundColor: worldInk.ticket,
    borderRadius: radius.md,
    borderTopWidth: 3,
    borderTopColor: color.primary,
    padding: space.s4,
    gap: space.s2,
    elevation: 3,
    shadowColor: worldInk.board,
  };
}

/** Nhãn trường in trên vé: chữ hoa, đậm, giãn chữ. */
export function labelStyle(onTicket: boolean): TextStyle {
  return {
    color: onTicket ? worldInk.ticketMuted : color.textMuted,
    fontFamily: fontFamily.sansBold,
    fontSize: typography.label.sp,
    letterSpacing: typography.label.letterSpacing,
    textTransform: 'uppercase',
  };
}

/** Số tiền: số đều cột, không nhỏ hơn 14sp, mực in xanh. */
export function moneyStyle(onTicket: boolean): TextStyle {
  return {
    color: onTicket ? color.primary : color.text,
    fontFamily: fontFamily.sansSemiBold,
    fontSize: typography.money.sp,
    fontVariant: ['tabular-nums'],
  };
}

/** Bảng ga đen chữ hổ phách. */
export function boardStyle(): { container: ViewStyle; title: TextStyle } {
  return {
    container: {
      backgroundColor: worldInk.board,
      borderRadius: radius.md,
      paddingVertical: space.s2,
      overflow: 'hidden',
    },
    title: {
      color: worldInk.signal,
      fontFamily: fontFamily.displaySemiBold,
      fontSize: typography.sm.sp,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      paddingHorizontal: space.s4,
      paddingVertical: space.s2,
    },
  };
}

/** Hàng bảng ga: chữ hẹp chữ hoa; hàng đang chọn chuyển xanh còn chỗ. */
export function boardRowStyle(selected: boolean): { container: ViewStyle; label: TextStyle } {
  return {
    container: {
      minHeight: touchTargetDp,
      paddingHorizontal: space.s4,
      paddingVertical: space.s2,
      backgroundColor: selected ? worldInk.boardRow : worldInk.board,
      borderTopWidth: 1,
      borderTopColor: worldInk.boardRow,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.s3,
    },
    label: {
      color: selected ? worldInk.signalGo : color.darkText,
      fontFamily: fontFamily.displaySemiBold,
      fontSize: typography.board.sp,
      fontVariant: ['tabular-nums'],
      textTransform: 'uppercase',
    },
  };
}

/** Ô nhập: viền 1,5 mực xanh; tiêu điểm 2dp; lỗi viền đỏ (kèm chữ lỗi ở component). */
export function fieldStyle(input: { focused?: boolean; invalid?: boolean }): TextStyle {
  return {
    minHeight: touchTargetDp,
    borderWidth: input.focused === true ? 2 : 1.5,
    borderColor: input.invalid === true ? color.danger : color.primary,
    borderRadius: radius.sm,
    paddingHorizontal: space.s3,
    paddingVertical: space.s2,
    backgroundColor: color.surface,
    color: color.text,
    fontFamily: fontFamily.sans,
    fontSize: typography.body.sp,
  };
}
