/**
 * Bảng style Pine Hill–Amanoi dùng chung cho Customer Android (đồng bộ @pinehill/ui-native).
 * Xuất plain object (không gọi `StyleSheet.create` lúc nạp module) để an toàn trong mọi test UI.
 */
import type { TextStyle, ViewStyle } from 'react-native';
import { color, radius, space, touchTargetDp, typography } from '@pinehill/ui-native';

export const stackScreenOptions = {
  headerTitleAlign: 'center',
  headerStyle: { backgroundColor: color.surface },
  headerTintColor: color.text,
  headerShadowVisible: false,
  contentStyle: { backgroundColor: color.bg },
} as const;

export const theme = {
  screen: {
    flex: 1,
    backgroundColor: color.bg,
    padding: space.s4,
    gap: space.s3,
  } satisfies ViewStyle,
  scroll: {
    flex: 1,
    backgroundColor: color.bg,
  } satisfies ViewStyle,
  scrollContent: {
    padding: space.s4,
    gap: space.s3,
  } satisfies ViewStyle,
  card: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    padding: space.s3,
    gap: space.s2,
  } satisfies ViewStyle,
  cardMuted: {
    backgroundColor: color.surfaceMuted,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    padding: space.s3,
    gap: space.s2,
  } satisfies ViewStyle,
  hairline: {
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  } satisfies ViewStyle,
  divider: {
    height: 1,
    backgroundColor: color.border,
  } satisfies ViewStyle,
  field: {
    borderWidth: 1,
    borderColor: color.borderStrong,
    borderRadius: radius.md,
    padding: space.s3,
    minHeight: touchTargetDp,
    backgroundColor: color.surface,
    color: color.text,
  } satisfies TextStyle,
  buttonPrimary: {
    minHeight: touchTargetDp,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space.s4,
    borderRadius: radius.md,
    backgroundColor: color.primary,
  } satisfies ViewStyle,
  buttonPrimaryText: {
    color: color.primaryContrast,
    fontSize: typography.body.sp,
    fontWeight: '600',
    textAlign: 'center',
  } satisfies TextStyle,
  buttonSecondary: {
    minHeight: touchTargetDp,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space.s4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  } satisfies ViewStyle,
  buttonSecondaryText: {
    color: color.text,
    fontSize: typography.body.sp,
    fontWeight: '500',
    textAlign: 'center',
  } satisfies TextStyle,
  buttonDanger: {
    minHeight: touchTargetDp,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space.s4,
    borderRadius: radius.md,
    backgroundColor: color.danger,
  } satisfies ViewStyle,
  buttonPlain: {
    minHeight: touchTargetDp,
    justifyContent: 'center',
    paddingHorizontal: space.s3,
  } satisfies ViewStyle,
  buttonPlainText: {
    color: color.primary,
    fontSize: typography.body.sp,
    fontWeight: '500',
  } satisfies TextStyle,
  title: {
    fontSize: typography.h1.sp,
    fontWeight: typography.h1.weight,
    color: color.text,
  } satisfies TextStyle,
  sectionTitle: {
    fontSize: typography.h2.sp,
    fontWeight: typography.h2.weight,
    color: color.text,
  } satisfies TextStyle,
  body: {
    fontSize: typography.body.sp,
    fontWeight: typography.body.weight,
    color: color.text,
  } satisfies TextStyle,
  muted: {
    fontSize: typography.sm.sp,
    color: color.textMuted,
  } satisfies TextStyle,
  caption: {
    fontSize: typography.caption.sp,
    color: color.textMuted,
  } satisfies TextStyle,
  tabular: {
    fontVariant: ['tabular-nums'],
  } satisfies TextStyle,
  money: {
    fontSize: typography.money.sp,
    fontWeight: typography.money.weight,
    color: color.text,
    fontVariant: ['tabular-nums'],
  } satisfies TextStyle,
  moneyInline: {
    fontSize: typography.body.sp,
    fontWeight: '600',
    color: color.text,
    fontVariant: ['tabular-nums'],
  } satisfies TextStyle,
  alertDanger: {
    fontSize: typography.sm.sp,
    color: color.danger,
  } satisfies TextStyle,
  alertWarning: {
    fontSize: typography.sm.sp,
    color: color.warning,
  } satisfies TextStyle,
  alertSuccess: {
    fontSize: typography.sm.sp,
    color: color.success,
  } satisfies TextStyle,
};
