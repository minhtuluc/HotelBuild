/** Màn chính sau khi đăng nhập: điều hướng tác vụ vận hành và đăng xuất (SCR-56, §8.1/§8.3). */
import { useEffect, useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { UserMe } from '@pinehill/contracts';
import { Board, BoardRow, color, waitMessage } from '@pinehill/ui-native';
import { contextRows } from '../src/context-bar';
import { isApiError } from '@pinehill/api-client';
import { isDemoEnabled } from '../src/config/index';
import { Session, PIN_LOCK_SECONDS } from '../src/session';
import { t } from '../src/strings';
import { theme } from '../src/theme';

export interface HomeScreenProps {
  session: Session;
  onLogout: () => void;
  onTasks?: () => void;
  onLookup?: () => void;
  onArrivals?: () => void;
  onWalkIn?: () => void;
  onDepartures?: () => void;
  /** HB-261: SCR-67 cảnh báo quá tải (từ đó mở SCR-63 đổi phòng). */
  onAlerts?: () => void;
  /** HB-263: SCR-68 đối soát tiền mặt theo ngày VN. */
  onCash?: () => void;
  demoMode?: boolean;
  /** HB-278: hồ sơ phiên cho thanh ngữ cảnh (vai trò). */
  profile?: UserMe | null;
  /** HB-278: tên cơ sở đang làm việc; không có thì thanh ngữ cảnh ghi "Pine Hill", không in id. */
  loadPropertyName?: () => Promise<string | null>;
}

/** Tên cơ sở đang làm việc (tải một lần) và giờ VN cập nhật mỗi phút. */
function useContext(loadPropertyName: (() => Promise<string | null>) | undefined) {
  const [propertyName, setPropertyName] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    let live = true;
    void loadPropertyName?.()
      .then((name) => {
        if (live) setPropertyName(name);
      })
      .catch(() => undefined);
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [loadPropertyName]);
  return { propertyName, nowMs };
}

function PinDemoSection({ session }: { session: Session }): ReactElement {
  const [pinResult, setPinResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function runPinDemo(): Promise<void> {
    setBusy(true);
    setPinResult(null);
    try {
      await session.verifyPin('123456', undefined);
      session.clearPinToken();
      setPinResult(t('home.pinDemo.ok', { purpose: 'demo' }));
    } catch (cause) {
      if (Session.isOffline(cause)) setPinResult(t('login.offline'));
      else if (isApiError(cause) && cause.knownCode === 'E_AUTH_PIN_LOCKED') {
        setPinResult(
          waitMessage('E_AUTH_PIN_LOCKED', cause.retryAfterSeconds ?? PIN_LOCK_SECONDS) ??
            t('pin.locked'),
        );
      } else {
        setPinResult(
          t('login.error', { code: isApiError(cause) ? (cause.code ?? 'UNKNOWN') : 'UNKNOWN' }),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Pressable
        testID="pin-demo"
        accessibilityRole="button"
        accessibilityLabel={t('home.pinDemo')}
        disabled={busy}
        onPress={() => void runPinDemo()}
        style={theme.buttonPrimary}
      >
        <Text style={theme.buttonPrimaryText}>{busy ? t('state.loading') : t('home.pinDemo')}</Text>
      </Pressable>
      {pinResult === null ? null : (
        <Text accessibilityLiveRegion="polite" style={theme.muted}>
          {pinResult}
        </Text>
      )}
    </>
  );
}

export default function HomeScreen({
  session,
  onLogout,
  onTasks,
  onLookup,
  onArrivals,
  onWalkIn,
  onDepartures,
  onAlerts,
  onCash,
  demoMode = isDemoEnabled(),
  profile = null,
  loadPropertyName,
}: HomeScreenProps): ReactElement {
  const { propertyName, nowMs } = useContext(loadPropertyName);
  const context = contextRows({ nowMs, role: profile?.role ?? 'FRONT_DESK', propertyName });
  const navItems: ReadonlyArray<{
    testID: string;
    label: string;
    onPress?: (() => void) | undefined;
  }> = [
    { testID: 'open-arrivals', label: t('home.arrivals'), onPress: onArrivals },
    { testID: 'open-departures', label: t('home.departures'), onPress: onDepartures },
    { testID: 'open-housekeeping', label: t('home.tasks'), onPress: onTasks },
    { testID: 'open-lookup', label: t('home.lookup'), onPress: onLookup },
    { testID: 'open-walk-in', label: t('home.walkIn'), onPress: onWalkIn },
    { testID: 'open-alerts', label: t('home.alerts'), onPress: onAlerts },
    { testID: 'open-cash', label: t('home.cash'), onPress: onCash },
  ];

  return (
    <View style={theme.screen}>
      <Text accessibilityRole="header" style={theme.title}>
        {t('home.title')}
      </Text>
      {/* HB-278: thanh ngữ cảnh và thanh công việc dạng bảng ga, như operations web. */}
      <Board title={context.title}>
        {context.rows.map((row) => (
          <BoardRow key={row} label={row} />
        ))}
      </Board>
      <Board title={t('home.tasksGroup')}>
        {navItems.map((item) =>
          item.onPress ? (
            <BoardRow
              key={item.testID}
              testID={item.testID}
              label={item.label}
              onPress={item.onPress}
            />
          ) : null,
        )}
      </Board>
      {demoMode ? <PinDemoSection session={session} /> : null}
      <Pressable
        testID="logout"
        accessibilityRole="button"
        accessibilityLabel={t('home.logout')}
        onPress={() => void session.logout().then(onLogout)}
        style={theme.buttonSecondary}
      >
        <Text style={[theme.buttonPlainText, { color: color.danger }]}>{t('home.logout')}</Text>
      </Pressable>
    </View>
  );
}
