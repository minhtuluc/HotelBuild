/** Điểm vào Operations Android: đăng nhập → me() → đổi mật khẩu/PIN/chọn cơ sở → màn chính. */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, View } from 'react-native';
import type { UserMe } from '@pinehill/contracts';
import { createSession } from '../src/session-factory';
import LoginScreen from './login';
import ChangePasswordScreen from './change-password';
import PinSetupScreen from './pin-setup';
import SelectPropertyScreen from './select-property';
import HomeScreen from './home';

type Stage = 'boot' | 'login' | 'changePassword' | 'pinSetup' | 'selectProperty' | 'home';

export default function RootScreen(): ReactElement {
  const session = useMemo(createSession, []);
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

  if (stage === 'boot') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator accessibilityLabel="Đang khôi phục phiên" />
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
  return <HomeScreen session={session} onLogout={() => setStage('login')} />;
}
