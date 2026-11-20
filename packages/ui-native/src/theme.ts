/**
 * HB-272 — bảng style dùng chung cho hai app Android theo hệ "vé tàu" của web (DESIGN.md).
 * - `guest` (Persuade, như web khách): nền mẫu biểu xanh xám, header/tab bảng ga chữ hổ phách, nút chính
 *   dấu bấm đỏ, tiêu đề chữ hẹp.
 * - `ops` (Operate, như operations web): nền làm việc, header bảng ga, nút chính mực xanh, tiêu đề chữ thân.
 * Giữ nguyên tên khoá cũ của `theme.ts` hai app để mọi màn đổi giao diện mà không sửa từng màn.
 * Xuất object thường (không `StyleSheet.create` lúc nạp module) để an toàn trong test UI.
 */
import type { TextStyle, ViewStyle } from 'react-native';
import { labelStyle, paperStyle, ticketStyle } from './components/styles.js';
import { color, fontFamily, radius, space, touchTargetDp, typography, worldInk } from './tokens.js';

export type ThemeSurface = 'guest' | 'ops';

interface Surface {
  readonly page: string;
  readonly action: string;
  readonly titleFont: string;
  readonly headerTint: string;
}

const SURFACES: Record<ThemeSurface, Surface> = {
  guest: {
    page: worldInk.ground,
    action: worldInk.punch,
    titleFont: fontFamily.displaySemiBold,
    headerTint: worldInk.signal,
  },
  ops: {
    page: color.bg,
    action: color.primary,
    titleFont: fontFamily.sansSemiBold,
    headerTint: color.darkText,
  },
};

function text(fontFamilyName: string, fontSize: number, ink: string = color.text): TextStyle {
  return { fontFamily: fontFamilyName, fontSize, color: ink };
}

function button(background: string, border: string): ViewStyle {
  return {
    minHeight: touchTargetDp,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space.s4,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: border,
    backgroundColor: background,
  };
}

function layout(page: string) {
  return {
    screen: {
      flex: 1,
      backgroundColor: page,
      padding: space.s4,
      gap: space.s3,
    } satisfies ViewStyle,
    scroll: { flex: 1, backgroundColor: page } satisfies ViewStyle,
    scrollContent: { padding: space.s4, gap: space.s3 } satisfies ViewStyle,
    card: paperStyle(),
    cardMuted: { ...paperStyle(), backgroundColor: color.surfaceMuted } satisfies ViewStyle,
    ticket: ticketStyle(),
    hairline: { borderBottomWidth: 1, borderBottomColor: color.border } satisfies ViewStyle,
    divider: { height: 1, backgroundColor: color.border } satisfies ViewStyle,
    board: {
      backgroundColor: worldInk.board,
      borderRadius: radius.md,
      padding: space.s3,
      gap: space.s2,
    } satisfies ViewStyle,
  };
}

function controls(action: string) {
  return {
    field: {
      ...text(fontFamily.sans, typography.body.sp),
      borderWidth: 1.5,
      borderColor: color.primary,
      borderRadius: radius.sm,
      padding: space.s3,
      minHeight: touchTargetDp,
      backgroundColor: color.surface,
    } satisfies TextStyle,
    buttonPrimary: button(action, action),
    buttonPrimaryText: {
      ...text(fontFamily.sansSemiBold, typography.body.sp, color.primaryContrast),
      textAlign: 'center',
    } satisfies TextStyle,
    buttonSecondary: button(color.surface, color.borderStrong),
    buttonSecondaryText: {
      ...text(fontFamily.sansMedium, typography.body.sp),
      textAlign: 'center',
    } satisfies TextStyle,
    buttonDanger: button(color.surface, color.danger),
    buttonPlain: {
      minHeight: touchTargetDp,
      justifyContent: 'center',
      paddingHorizontal: space.s3,
    } satisfies ViewStyle,
    buttonPlainText: text(fontFamily.sansMedium, typography.body.sp, color.primary),
  };
}

function type(titleFont: string) {
  const tabular: TextStyle['fontVariant'] = ['tabular-nums'];
  return {
    title: text(titleFont, titleFont === fontFamily.displaySemiBold ? 28 : typography.h1.sp),
    sectionTitle: text(fontFamily.sansSemiBold, typography.h2.sp),
    body: text(fontFamily.sans, typography.body.sp),
    muted: text(fontFamily.sans, typography.sm.sp, color.textMuted),
    caption: text(fontFamily.sans, typography.caption.sp, color.textMuted),
    label: labelStyle(false),
    tabular: { fontVariant: tabular } satisfies TextStyle,
    money: { ...text(fontFamily.sansSemiBold, typography.money.sp), fontVariant: tabular },
    moneyInline: { ...text(fontFamily.sansSemiBold, typography.body.sp), fontVariant: tabular },
    alertDanger: text(fontFamily.sans, typography.sm.sp, color.danger),
    alertWarning: text(fontFamily.sans, typography.sm.sp, color.warning),
    alertSuccess: text(fontFamily.sans, typography.sm.sp, color.success),
  };
}

export function createTheme(surface: ThemeSurface) {
  const ink = SURFACES[surface];
  const headerTitleStyle = { fontFamily: ink.titleFont, fontSize: typography.h2.sp };
  return {
    theme: { ...layout(ink.page), ...controls(ink.action), ...type(ink.titleFont) },
    stackScreenOptions: {
      headerTitleAlign: 'center',
      headerStyle: { backgroundColor: worldInk.board },
      headerTintColor: ink.headerTint,
      headerTitleStyle,
      headerShadowVisible: false,
      contentStyle: { backgroundColor: ink.page },
    } as const,
    tabScreenOptions: {
      headerTitleAlign: 'center',
      headerStyle: { backgroundColor: worldInk.board },
      headerTintColor: ink.headerTint,
      headerTitleStyle,
      headerShadowVisible: false,
      sceneStyle: { backgroundColor: ink.page },
      tabBarStyle: { backgroundColor: worldInk.board, borderTopColor: worldInk.boardRow },
      tabBarActiveTintColor: worldInk.signal,
      tabBarInactiveTintColor: color.darkTextMuted,
      tabBarLabelStyle: { fontFamily: fontFamily.displaySemiBold, fontSize: 17 },
    } as const,
  };
}
