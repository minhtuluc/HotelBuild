/** Điểm vào Operations Android: đăng nhập → me() → đổi mật khẩu/PIN/chọn cơ sở → màn chính. */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, View } from 'react-native';
import type { UserMe } from '@pinehill/contracts';
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
import { t } from '../src/strings';

type Stage =
  | 'boot'
  | 'login'
  | 'changePassword'
  | 'pinSetup'
  | 'selectProperty'
  | 'home'
  | 'housekeeping'
  | 'lookup'
  | 'arrivals';

export default function RootScreen(): ReactElement {
  const session = useMemo(createSession, []);
  const makeTaskWriter = useCallback(() => createTaskWriter(session), [session]);
  const makeCheckInWriter = useCallback(() => createCheckInWriter(session), [session]);
  const arrivalsCache = useMemo(() => new ArrivalsCache(), []);
  const [stage, setStage] = useState<Stage>('boot');
  const [currentPassword, setCurrentPassword] = useState('');
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
        if (!session.hasAccessToken()) arrivalsCache.clear();
      }),
    [session, arrivalsCache],
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
  const tools: Partial<Record<Stage, () => ReactElement>> = {
    housekeeping: () => (
      <HousekeepingReadScreen session={session} createWriter={makeTaskWriter} onBack={goHome} />
    ),
    arrivals: () => (
      <ArrivalsScreen
        session={session}
        cache={arrivalsCache}
        createWriter={makeCheckInWriter}
        onBack={goHome}
      />
    ),
    lookup: () => <LookupScreen session={session} onBack={goHome} />,
  };

  if (stage === 'boot') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator accessibilityLabel={t('session.restoring')} />
      </View>
    );
  }
  if (stage === 'login') {
    return (
      <LoginScreen session={session} onAuthenticated={() => void session.profile().then(advance)} />
    );
  }
  if (stage === 'changePassword') {
    return (
      <ChangePasswordScreen
        session={session}
        onDone={(password) => {
          setCurrentPassword(password);
          void session.profile().then(advance);
        }}
      />
    );
  }
  if (stage === 'pinSetup') {
    return (
      <PinSetupScreen
        session={session}
        currentPassword={currentPassword}
        onDone={() => void session.profile().then(advance)}
      />
    );
  }
  if (stage === 'selectProperty') {
    return (
      <SelectPropertyScreen
        properties={profile?.propertyScope ?? []}
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
    />
  );
}
