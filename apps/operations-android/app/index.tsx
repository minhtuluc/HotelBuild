/** Điểm vào Operations Android: đăng nhập → me() → đổi mật khẩu/PIN/chọn cơ sở → màn chính. */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, BackHandler, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { color } from '@pinehill/ui-native';
import type { BookingSummary, UserMe } from '@pinehill/contracts';
import { createSession } from '../src/session-factory';
import LoginScreen from './login';
import ChangePasswordScreen from './change-password';
import PinSetupScreen from './pin-setup';
import SelectPropertyScreen from './select-property';
import HomeScreen from './home';
import { HousekeepingReadScreen } from '../src/housekeeping/screen';
import { createTaskWriter } from '../src/housekeeping/writer-factory.native';
import { LookupScreen } from '../src/lookup/screen';
import { ArrivalsScreen } from '../src/arrivals/screen';
import { ArrivalsCache } from '../src/arrivals/reader';
import { createCheckInWriter } from '../src/arrivals/writer-factory.native';
import { NoShowScreen } from '../src/no-show/screen';
import { createNoShowWriter } from '../src/no-show/writer-factory.native';
import { WalkInScreen } from '../src/walk-in/screen';
import { createWalkInFlow } from '../src/walk-in/flow-factory.native';
import { CollectScreen } from '../src/stay/collect';
import { DeparturesScreen } from '../src/stay/screen';
import { createCheckOutWriter, createCollectWriter } from '../src/stay/writer-factory.native';
import { t } from '../src/strings';
import { CashScreen } from '../src/reconciliation/screen';
import { createCloseWriter } from '../src/reconciliation/writer-factory.native';
import { publicPropertyList } from '../src/property-names';
import { backStep, stageTitle, type Stage } from '../src/stages';

export default function RootScreen(): ReactElement {
  const session = useMemo(createSession, []);
  const makeTaskWriter = useCallback(() => createTaskWriter(session), [session]);
  const makeCheckInWriter = useCallback(() => createCheckInWriter(session), [session]);
  const noShowWriter = useMemo(() => createNoShowWriter(session), [session]);
  const arrivalsCache = useMemo(() => new ArrivalsCache(), []);
  const [noShowTarget, setNoShowTarget] = useState<BookingSummary | null>(null);
  const makeWalkInFlow = useCallback(() => createWalkInFlow(session), [session]);
  const makeCheckOutWriter = useCallback(() => createCheckOutWriter(session), [session]);
  const makeCollectWriter = useCallback(() => createCollectWriter(session), [session]);
  const makeCloseWriter = useCallback(() => createCloseWriter(session), [session]);
  // `resourceClient()` ghim token lúc tạo: tạo ở từng lần gọi để dùng token sau khi đăng nhập (HB-264).
  const listProperties = useCallback(
    () => publicPropertyList(session.resourceClient())(),
    [session],
  );
  const [collecting, setCollecting] = useState<BookingSummary | null>(null);
  const [walkInFromArrivals, setWalkInFromArrivals] = useState(false);
  const [stage, setStage] = useState<Stage>('boot');
  const [profile, setProfile] = useState<UserMe | null>(null);

  /** Chọn bước kế tiếp theo hồ sơ phiên (`/auth/me`): đổi mật khẩu → PIN → cơ sở → màn chính. */
  async function advance(user: UserMe): Promise<void> {
    setProfile(user);
    if (user.mustChangePassword) {
      setStage('changePassword');
      return;
    }
    if (!user.hasPin) {
      setStage('pinSetup');
      return;
    }
    if (user.propertyScope.length > 1) {
      setStage('selectProperty');
      return;
    }
    const only = user.propertyScope[0];
    if (only !== undefined) session.selectProperty(only);
    setStage('home');
  }

  // Dữ liệu khách đến chỉ nằm trong RAM của phiên: mất token (đăng xuất/thu hồi) là xoá ngay.
  useEffect(
    () =>
      session.subscribe(() => {
        noShowWriter.reset();
        if (!session.hasAccessToken()) {
          arrivalsCache.clear();
          setNoShowTarget(null);
          setCollecting(null);
          setWalkInFromArrivals(false);
        }
      }),
    [session, arrivalsCache, noShowWriter],
  );

  useEffect(() => {
    void (async () => {
      const restored = await session.silentRefresh().catch(() => false);
      if (!restored) {
        setStage('login');
        return;
      }
      await advance(await session.profile());
    })();
  }, [session]);

  const goHome = () => setStage('home');
  // HB-252: cả luồng nằm trong một route nên Back mặc định thoát app; đóng màn con hoặc về màn chính trước.
  const back = backStep({
    stage,
    noShow: noShowTarget !== null,
    collecting: collecting !== null,
    walkInFromArrivals,
  });
  useEffect(() => {
    if (back === 'default') return undefined;
    const steps = {
      closeNoShow: () => setNoShowTarget(null),
      closeCollect: () => setCollecting(null),
      closeWalkIn: () => setWalkInFromArrivals(false),
      home: goHome,
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      steps[back]();
      return true;
    });
    return () => subscription.remove();
  }, [back]);
  const arrivalsStage = (): ReactElement => {
    if (noShowTarget !== null)
      return (
        <NoShowScreen
          session={session}
          booking={noShowTarget}
          writer={noShowWriter}
          now={Date.now}
          onChanged={() => undefined}
          onClose={() => setNoShowTarget(null)}
        />
      );
    if (collecting !== null)
      return (
        <CollectScreen
          session={session}
          booking={collecting}
          createWriter={makeCollectWriter}
          onClose={() => setCollecting(null)}
        />
      );
    // Quay lại từ SCR-65 dựng lại danh sách nên tự tải lại: booking vãng lai mới hiện ngay.
    if (walkInFromArrivals)
      return (
        <WalkInScreen
          session={session}
          createFlow={makeWalkInFlow}
          onBack={() => setWalkInFromArrivals(false)}
        />
      );
    return (
      <ArrivalsScreen
        session={session}
        cache={arrivalsCache}
        createWriter={makeCheckInWriter}
        onBack={goHome}
        onNoShow={setNoShowTarget}
        onCollectBalance={setCollecting}
        onWalkIn={() => setWalkInFromArrivals(true)}
      />
    );
  };
  const tools: Partial<Record<Stage, () => ReactElement>> = {
    housekeeping: () => (
      <HousekeepingReadScreen session={session} createWriter={makeTaskWriter} onBack={goHome} />
    ),
    arrivals: () => arrivalsStage(),
    departures: () => (
      <DeparturesScreen
        session={session}
        createCheckOutWriter={makeCheckOutWriter}
        createCollectWriter={makeCollectWriter}
        onBack={goHome}
      />
    ),
    lookup: () => <LookupScreen session={session} onBack={goHome} />,
    cash: () => (
      <CashScreen
        session={session}
        role={profile?.role ?? 'FRONT_DESK'}
        createWriter={makeCloseWriter}
        onBack={goHome}
      />
    ),
    walkIn: () => <WalkInScreen session={session} createFlow={makeWalkInFlow} onBack={goHome} />,
  };

  const body = (): ReactElement => {
    if (stage === 'boot') {
      return (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: color.bg,
          }}
        >
          <ActivityIndicator accessibilityLabel={t('session.restoring')} color={color.primary} />
        </View>
      );
    }
    if (stage === 'login') {
      return (
        <LoginScreen
          session={session}
          onAuthenticated={() => void session.profile().then(advance)}
        />
      );
    }
    if (stage === 'changePassword') {
      return (
        <ChangePasswordScreen
          session={session}
          onDone={() => void session.profile().then(advance)}
        />
      );
    }
    if (stage === 'pinSetup') {
      return (
        <PinSetupScreen session={session} onDone={() => void session.profile().then(advance)} />
      );
    }
    if (stage === 'selectProperty') {
      return (
        <SelectPropertyScreen
          properties={profile?.propertyScope ?? []}
          listProperties={listProperties}
          onSelect={(propertyId) => {
            session.selectProperty(propertyId);
            setStage('home');
          }}
        />
      );
    }
    const tool = tools[stage];
    if (tool !== undefined) return tool();
    return (
      <HomeScreen
        session={session}
        onLogout={() => setStage('login')}
        onTasks={() => setStage('housekeeping')}
        onLookup={() => setStage('lookup')}
        onArrivals={() => setStage('arrivals')}
        onWalkIn={() => setStage('walkIn')}
        onDepartures={() => setStage('departures')}
        onAlerts={() => router.push('/alerts')}
        onCash={() => setStage('cash')}
      />
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: stageTitle(stage) }} />
      {body()}
    </>
  );
}
