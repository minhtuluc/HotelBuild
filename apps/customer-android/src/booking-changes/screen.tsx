import type { ReactElement } from 'react';
import { ActivityIndicator, ScrollView, Text } from 'react-native';
import { Link, useLocalSearchParams } from 'expo-router';
import { color, space, typography } from '@pinehill/ui-native';
import type { BookingSummary } from '@pinehill/contracts';
import { formatVnd } from '../search';
import type { ChangeController } from './controller';
import { useChangeScreen } from './use-screen';
import { changeText, noticeText } from './strings';
import { ChangeButton, ChangeForm, PreviewBody, ResultBody } from './parts';
import type { ChangeDraft, ChangeKind, ChangeState } from './types';

export function BookingChangeScreen({ kind }: { kind: ChangeKind }): ReactElement {
  const params = useLocalSearchParams<{ code?: string }>();
  const code = typeof params.code === 'string' ? params.code : '';
  const { booking, controller, view, failure, loading, draft, setDraft, reload } = useChangeScreen(
    code,
    kind,
  );
  return (
    <Surface
      code={code}
      kind={kind}
      booking={booking}
      controller={controller}
      view={view}
      failure={failure}
      loading={loading}
      draft={draft}
      setDraft={setDraft}
      reload={reload}
    />
  );
}

function Surface({
  code,
  kind,
  booking,
  controller,
  view,
  failure,
  loading,
  draft,
  setDraft,
  reload,
}: {
  code: string;
  kind: ChangeKind;
  booking: BookingSummary | null;
  controller: ChangeController | null;
  view: ChangeState | null;
  failure: string | null;
  loading: boolean;
  draft: ChangeDraft;
  setDraft(draft: ChangeDraft): void;
  reload(): void;
}): ReactElement {
  const denied = view?.phase === 'denied';
  const busy = isBusy(view);
  const notice = currentNotice(failure, view);
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: space.s4, gap: space.s3 }}
    >
      <Text
        accessibilityRole="header"
        style={{ color: color.text, fontSize: typography.h1.sp, fontWeight: '700' }}
      >
        {changeText(kind)}
      </Text>
      {loading || busy ? (
        <ActivityIndicator accessibilityLabel={changeText('loading')} color={color.primary} />
      ) : null}
      {notice ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={{ color: color.warning }}
        >
          {noticeText(notice)}
        </Text>
      ) : null}
      {showBooking(loading, booking, denied) && booking ? (
        <LoadedBody
          booking={booking}
          kind={kind}
          draft={draft}
          view={view}
          controller={controller}
          setDraft={setDraft}
        />
      ) : null}
      {canReload(loading, failure, view) ? (
        <ChangeButton label={changeText('reload')} onPress={reload} />
      ) : null}
      {notice === 'expired' ? (
        <Link href="/(tabs)/account" accessibilityRole="link">
          {changeText('login')}
        </Link>
      ) : null}
      <Link href={{ pathname: '/booking/[code]', params: { code } }} accessibilityRole="link">
        {changeText('back')}
      </Link>
    </ScrollView>
  );
}

function LoadedBody({
  booking,
  kind,
  draft,
  view,
  controller,
  setDraft,
}: {
  booking: BookingSummary;
  kind: ChangeKind;
  draft: ChangeDraft;
  view: ChangeState | null;
  controller: ChangeController | null;
  setDraft(draft: ChangeDraft): void;
}): ReactElement {
  const editable = view?.phase === 'editing' || view?.phase === 'previewed';
  return (
    <>
      <Text style={{ color: color.text }}>
        {changeText('current', {
          code: booking.code,
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
        })}
      </Text>
      <Text style={{ color: color.text }}>
        {changeText('total', { amount: formatVnd(booking.totalAmount) })}
      </Text>
      {view?.phase === 'done' && view.result ? (
        <ResultBody result={view.result} />
      ) : (
        <>
          <ChangeForm
            kind={kind}
            draft={draft}
            disabled={!editable}
            edit={(value) => {
              controller?.edit(value);
              setDraft(value);
            }}
          />
          {view?.preview ? <PreviewBody preview={view.preview} /> : null}
          <Actions controller={controller} view={view} />
        </>
      )}
    </>
  );
}
function Actions({
  controller,
  view,
}: {
  controller: ChangeController | null;
  view: ChangeState | null;
}): ReactElement | null {
  if (!controller || !view) return null;
  if (view.phase === 'unknown')
    return (
      <ChangeButton
        label={changeText('retry')}
        disabled={view.notice === 'reconcile'}
        onPress={() => void controller.retry()}
      />
    );
  if (view.phase === 'previewed')
    return (
      <>
        <ChangeButton label={changeText('preview')} onPress={() => void controller.preview()} />
        <ChangeButton label={changeText('confirm')} onPress={() => void controller.confirm()} />
      </>
    );
  return view.phase === 'editing' ? (
    <ChangeButton label={changeText('preview')} onPress={() => void controller.preview()} />
  ) : null;
}

function isBusy(view: ChangeState | null): boolean {
  return view?.phase === 'previewing' || view?.phase === 'submitting';
}
function currentNotice(
  failure: string | null,
  view: ChangeState | null,
): string | null | undefined {
  return failure ?? view?.notice;
}
function showBooking(loading: boolean, booking: BookingSummary | null, denied: boolean): boolean {
  return !loading && booking !== null && !denied;
}
function canReload(loading: boolean, failure: string | null, view: ChangeState | null): boolean {
  return !loading && (failure !== null || view?.phase === 'conflict');
}
