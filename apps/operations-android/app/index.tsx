/** Điểm vào Operations Android: đăng nhập → đổi mật khẩu (nếu cần) → đặt PIN → màn chính. */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { createSession } from '../src/session-factory';
import LoginScreen from './login';
import ChangePasswordScreen from './change-password';
import PinSetupScreen from './pin-setup';
import HomeScreen from './home';

type Stage = 'boot' | 'login' | 'changePassword' | 'pinSetup' | 'home';

export default function RootScreen(): ReactElement {
  const session = useMemo(createSession, []);
  const [stage, setStage] = useState<Stage>('boot');
  const [currentPassword, setCurrentPassword] = useState('');

  useEffect(() => {
    void (async () => {
      const ok = await session.silentRefresh().catch(() => false);
      setStage(ok ? 'home' : 'login');
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
      <LoginScreen
        session={session}
        onAuthenticated={(outcome) =>
          setStage(outcome.mustChangePassword ? 'changePassword' : 'pinSetup')
        }
      />
    );
  }
  if (stage === 'changePassword') {
    return (
      <ChangePasswordScreen
        session={session}
        onDone={(password) => {
          setCurrentPassword(password);
          setStage('pinSetup');
        }}
      />
    );
  }
  if (stage === 'pinSetup') {
    return (
      <PinSetupScreen
        session={session}
        currentPassword={currentPassword}
        onDone={() => setStage('home')}
      />
    );
  }
  return <HomeScreen session={session} onLogout={() => setStage('login')} />;
}
