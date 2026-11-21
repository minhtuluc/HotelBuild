/**
 * SCR-83 (HB-115, HB-260) — hồ sơ khách trên Android.
 *
 * Đọc `GET /guests/me` + `GET /guests/me/loyalty` và sửa bằng `PATCH /guests/me` qua client đã có access
 * token của phiên (không gửi `guestId` nào). Mọi nhãn ở `src/strings.ts`, phần tử tương tác đều có nhãn
 * trợ năng.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { color, space, formatDateTimeVn } from '@pinehill/ui-native';
import type { GuestLoyalty, GuestSummary } from '@pinehill/contracts';
import { useFocusEffect } from 'expo-router';
import { LoginPrompt } from '../../src/login-prompt';
import { createSession } from '../../src/session-factory';
import { netInfoSource } from '../../src/netinfo-device.native';
import type { NetInfoSource } from '../../src/netinfo';
import { ProfileEditor } from '../../src/profile-editor';
import { t, type MessageKey } from '../../src/strings';
import { theme } from '../../src/theme';
import {
  TIER_LABEL_KEYS,
  loadProfile,
  loyaltyRows,
  profileApiFrom,
  profileRows,
  tierMismatch,
  type ProfileApi,
  type ProfileOutcome,
  type ProfileRow,
} from '../../src/profile';

const CELL = { color: color.text } as const;

const PROFILE_KEYS: Readonly<Record<ProfileRow['key'], MessageKey>> = {
  name: 'profile.name',
  phone: 'profile.phone',
  email: 'profile.email',
  created: 'profile.created',
  consent: 'profile.consent',
};

const LOYALTY_KEYS: Readonly<Record<'points' | 'stays12' | 'staysTotal', MessageKey>> = {
  points: 'profile.points',
  stays12: 'profile.stays12',
  staysTotal: 'profile.staysTotal',
};

function rowValue(row: ProfileRow): string {
  if (row.key === 'created') return formatDateTimeVn(row.value);
  if (row.key === 'consent')
    return t(row.value === 'yes' ? 'profile.consentYes' : 'profile.consentNo');
  return row.value;
}

function ProfileCard({ guest }: { guest: GuestSummary }): ReactElement {
  return (
    <View style={theme.card}>
      <Text accessibilityRole="header" style={theme.sectionTitle}>
        {t('profile.heading')}
      </Text>
      {profileRows(guest, t('profile.dash')).map((row) => (
        <View
          key={row.key}
          accessible
          accessibilityLabel={`${t(PROFILE_KEYS[row.key])}: ${rowValue(row)}`}
          style={[
            { flexDirection: 'row', gap: space.s2, paddingVertical: space.s1 },
            theme.hairline,
          ]}
        >
          <Text style={{ color: color.textMuted, flex: 1 }}>{t(PROFILE_KEYS[row.key])}</Text>
          <Text style={[CELL, theme.tabular]}>{rowValue(row)}</Text>
        </View>
      ))}
    </View>
  );
}

function LoyaltyPanel({
  guest,
  loyalty,
}: {
  guest: GuestSummary;
  loyalty: GuestLoyalty;
}): ReactElement {
  return (
    <View style={theme.card}>
      <Text accessibilityRole="header" style={theme.sectionTitle}>
        {t('profile.loyalty.title')}
      </Text>
      <Text style={CELL} data-testid="profile-tier">
        {t('profile.tier', { tier: t(TIER_LABEL_KEYS[guest.loyaltyTier]) })}
      </Text>
      {loyaltyRows(loyalty).map((row) => (
        <View
          key={row.key}
          accessible
          accessibilityLabel={`${t(LOYALTY_KEYS[row.key])}: ${row.value}`}
          style={[
            { flexDirection: 'row', gap: space.s2, paddingVertical: space.s1 },
            theme.hairline,
          ]}
        >
          <Text style={{ color: color.textMuted, flex: 1 }}>{t(LOYALTY_KEYS[row.key])}</Text>
          <Text style={[CELL, theme.tabular]}>{row.value}</Text>
        </View>
      ))}
      {!tierMismatch(guest, loyalty) ? null : (
        <Text accessibilityRole="alert" style={theme.alertWarning}>
          {t('profile.mismatch')}
        </Text>
      )}
    </View>
  );
}

function Notice({
  alert,
  offline,
  failedCode,
}: {
  alert: string | null;
  offline: boolean;
  failedCode: string | null;
}): ReactElement {
  return (
    <>
      {alert === null ? null : (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={{ color: color.danger }}
        >
          {alert}
        </Text>
      )}
      {!offline ? null : (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={{ color: color.danger }}
        >
          {t('guest.offline')}
        </Text>
      )}
      {failedCode === null ? null : (
        <Text accessibilityRole="alert" style={{ color: color.danger }}>
          {t('profile.failed', { code: failedCode })}
        </Text>
      )}
    </>
  );
}

function ReloadButton({ busy, onReload }: { busy: boolean; onReload: () => void }): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('profile.reload')}
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={onReload}
      style={theme.buttonSecondary}
    >
      <Text style={theme.buttonPlainText}>{t('profile.reload')}</Text>
    </Pressable>
  );
}

function ProfileBody({
  outcome,
  alert,
  busy,
  onReload,
  api,
  net,
  onSaved,
}: {
  outcome: ProfileOutcome | null;
  alert: string | null;
  busy: boolean;
  onReload: () => void;
  api: ProfileApi;
  net: NetInfoSource;
  onSaved: (next: ProfileOutcome) => void;
}): ReactElement {
  const offline = outcome !== null && outcome.kind === 'offline';
  const failedCode =
    outcome !== null && outcome.kind === 'failed' ? (outcome.code ?? 'UNKNOWN') : null;
  return (
    <>
      <Notice alert={alert} offline={offline} failedCode={failedCode} />
      {!busy ? null : (
        <ActivityIndicator accessibilityLabel={t('state.loading')} color={color.primary} />
      )}
      {outcome === null || outcome.kind !== 'ready' ? null : (
        <>
          <ProfileCard guest={outcome.profile} />
          <ProfileEditor
            guest={outcome.profile}
            api={api}
            net={net}
            onSaved={(profile) => onSaved({ ...outcome, profile })}
          />
          <LoyaltyPanel guest={outcome.profile} loyalty={outcome.loyalty} />
        </>
      )}
      <ReloadButton busy={busy} onReload={onReload} />
    </>
  );
}

export default function AccountScreen(): ReactElement {
  const session = useMemo(() => createSession(), []);
  const net = useMemo(() => netInfoSource(), []);
  const [ready, setReady] = useState(false);
  const [outcome, setOutcome] = useState<ProfileOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  // HB-249: kiểm lại phiên mỗi lần mở tab — khách có thể vừa đăng nhập ở màn `/login` rồi quay về.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void session.silentRefresh().then((ok) => {
        if (cancelled) return;
        setSignedIn(ok);
        setReady(true);
      });
      return () => {
        cancelled = true;
      };
    }, [session]),
  );

  const api = useMemo(() => profileApiFrom(session.apiClient()), [session]);
  const load = useCallback(async (): Promise<void> => {
    setBusy(true);
    setAlert(null);
    setOutcome(await loadProfile({ api, net }));
    setBusy(false);
  }, [api, net]);

  useEffect(() => {
    if (!ready || !signedIn) return;
    void load();
  }, [load, ready, signedIn]);

  if (!ready)
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: color.bg,
        }}
      >
        <ActivityIndicator accessibilityLabel={t('state.loading')} color={color.primary} />
      </View>
    );

  return (
    <ScrollView style={theme.scroll} contentContainerStyle={theme.scrollContent}>
      <Text accessibilityRole="header" style={theme.title}>
        {t('profile.title')}
      </Text>
      {signedIn ? (
        <>
          <ProfileBody
            outcome={outcome}
            alert={alert}
            busy={busy}
            api={api}
            net={net}
            onSaved={setOutcome}
            onReload={() => {
              void load();
            }}
          />
          <Pressable
            testID="logout"
            accessibilityRole="button"
            accessibilityLabel={t('home.logout')}
            onPress={() => void session.logout().then(() => setSignedIn(false))}
            style={theme.buttonSecondary}
          >
            <Text style={{ color: color.danger, fontWeight: '500' }}>{t('home.logout')}</Text>
          </Pressable>
        </>
      ) : (
        <LoginPrompt hint="account.loginHint" />
      )}
    </ScrollView>
  );
}
