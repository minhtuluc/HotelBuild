/**
 * Hợp đồng trạng thái UI trên Android (§8.1 + §8.3).
 * Kiểu `ScreenState` dùng chung một định nghĩa với web (import type, không phát sinh phụ thuộc runtime).
 * Quy tắc giống web: không hiện số 0/thành công giả, không rò dữ liệu, không last-write-wins,
 * hết hạn thì khoá xác nhận, và không kết luận "thất bại" khi chưa rõ kết quả.
 */
import type { ReactElement, ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { ScreenState } from '@pinehill/ui-web';
import type { StateMessageKey } from './stateMessages.js';
import { formatDateTimeVn } from './format.js';
import { color, radius, space, touchTargetDp, typography } from './tokens.js';

export type { ScreenState };

export type Translate = (
  key: StateMessageKey,
  vars?: Readonly<Record<string, string | number>>,
) => string;

const textStyle = { fontSize: typography.body.sp, color: color.text } as const;
const secondaryStyle = { fontSize: typography.sm.sp, color: color.textMuted } as const;

function ActionButton({ label, onPress }: { label: string; onPress: () => void }): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        minHeight: touchTargetDp,
        minWidth: touchTargetDp,
        justifyContent: 'center',
        paddingHorizontal: space.s3,
        backgroundColor: color.primary,
        borderRadius: radius.md,
      }}
    >
      <Text style={{ color: color.surface, fontSize: typography.body.sp, fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}

export interface NativeStateSurfaceProps {
  state: ScreenState;
  t: Translate;
  children?: ReactNode;
}

function LoadingBlock({ t }: { t: Translate }): ReactElement {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLiveRegion="polite"
      style={{ padding: space.s4 }}
    >
      <Text style={textStyle}>{t('state.loading')}</Text>
    </View>
  );
}

function ForbiddenBlock({ t }: { t: Translate }): ReactElement {
  return (
    <View accessibilityRole="alert" style={{ padding: space.s4 }}>
      <Text style={textStyle}>{t('state.forbidden')}</Text>
    </View>
  );
}

function ConflictBlock({
  t,
  state,
}: {
  t: Translate;
  state: Extract<ScreenState, { kind: 'conflict' }>;
}): ReactElement {
  return (
    <View accessibilityRole="alert" style={{ padding: space.s4, gap: space.s3 }}>
      <Text style={textStyle}>
        {t('state.conflict', { attempted: state.attemptedVersion, current: state.currentVersion })}
      </Text>
      <ActionButton label={t('state.conflict.reload')} onPress={state.onReload} />
    </View>
  );
}

function ExpiredBlock({
  t,
  state,
}: {
  t: Translate;
  state: Extract<ScreenState, { kind: 'expired' }>;
}): ReactElement {
  return (
    <View accessibilityRole="alert" style={{ padding: space.s4, gap: space.s3 }}>
      <Text style={textStyle}>
        {t('state.expired', { time: formatDateTimeVn(state.expiresAt) })}
      </Text>
      <ActionButton label={t('state.expired.reload')} onPress={state.onReload} />
    </View>
  );
}

function UnknownOutcomeBlock({
  t,
  state,
}: {
  t: Translate;
  state: Extract<ScreenState, { kind: 'unknownOutcome' }>;
}): ReactElement {
  return (
    <View accessibilityRole="alert" style={{ padding: space.s4, gap: space.s3 }}>
      <Text style={textStyle}>{t('state.unknownOutcome', { reference: state.referenceId })}</Text>
      <ActionButton label={t('state.unknownOutcome.lookup')} onPress={state.onLookup} />
    </View>
  );
}

function EmptyBlock({
  t,
  state,
}: {
  t: Translate;
  state: Extract<ScreenState, { kind: 'empty' }>;
}): ReactElement {
  const key =
    state.reason === 'noData'
      ? ('state.empty.noData' as const)
      : state.reason === 'filtered'
        ? ('state.empty.filtered' as const)
        : ('state.empty.soldOut' as const);
  return (
    <View accessibilityRole="alert" style={{ padding: space.s4, gap: space.s3 }}>
      <Text style={textStyle}>{t(key)}</Text>
      {state.canCreate && state.onCreate !== undefined ? (
        <ActionButton label={t('state.empty.create')} onPress={state.onCreate} />
      ) : null}
    </View>
  );
}

/** Trạng thái thay thế nội dung: không render children để không cho xác nhận hay lộ dữ liệu. */
function NativeReplacement({
  t,
  state,
}: {
  t: Translate;
  state: ScreenState;
}): ReactElement | null {
  switch (state.kind) {
    case 'loading':
      return <LoadingBlock t={t} />;
    case 'empty':
      return <EmptyBlock t={t} state={state} />;
    case 'forbidden':
      return <ForbiddenBlock t={t} />;
    case 'conflict':
      return <ConflictBlock t={t} state={state} />;
    case 'expired':
      return <ExpiredBlock t={t} state={state} />;
    case 'unknownOutcome':
      return <UnknownOutcomeBlock t={t} state={state} />;
    case 'success':
      return (
        <View accessibilityRole="alert" style={{ padding: space.s4 }}>
          <Text style={textStyle}>{t('state.success')}</Text>
        </View>
      );
    default:
      return null;
  }
}

function NativeSurrounding({
  t,
  state,
}: {
  t: Translate;
  state: ScreenState;
}): ReactElement | null {
  if (state.kind === 'refreshing') {
    return (
      <View accessibilityLiveRegion="polite" style={{ padding: space.s3 }}>
        <Text style={secondaryStyle}>
          {t('state.refreshing', { time: formatDateTimeVn(state.updatedAt) })}
          {state.stale ? ` · ${t('state.refreshing.stale')}` : ''}
        </Text>
      </View>
    );
  }
  if (state.kind === 'validationError') {
    return (
      <View accessibilityRole="alert" style={{ padding: space.s3, gap: space.s2 }}>
        <Text style={textStyle}>{t('state.validation', { count: state.details.length })}</Text>
        {state.details.map((detail) => (
          <Text key={detail.field} style={secondaryStyle}>
            {t('state.validation.field', { field: detail.field, issue: detail.issue })}
          </Text>
        ))}
      </View>
    );
  }
  return null;
}

export function NativeStateSurface({ state, t, children }: NativeStateSurfaceProps): ReactElement {
  const replacement = NativeReplacement({ t, state });
  if (replacement !== null) return replacement;
  return (
    <View>
      <NativeSurrounding t={t} state={state} />
      {children}
    </View>
  );
}
