'use client';

/**
 * SCR-13 — hồ sơ khách & điểm (customer web), **phần chỉ-đọc** theo quyết định của chủ dự án ở HB-105:
 * hai tuyến self `GET /guests/me` và `GET /guests/me/loyalty`. Phần cập nhật hồ sơ và yêu cầu ẩn danh hoá
 * bị **cắt** cho tới khi có tuyến ghi tương ứng (màn hình nói rõ, không dựng nút giả).
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { createSessionClient } from '@pinehill/web-session/client';
import { isApiError } from '@pinehill/api-client';
import type { GuestLoyalty, GuestSummary } from '@pinehill/contracts';
import {
  AccessDeniedPanel,
  StateSurface,
  actionMessageKey,
  formatDateTimeVn,
  mapErrorToUiAction,
  type ScreenState,
} from '@pinehill/ui-web';
import { t, type CustomerMessageKey } from '../../../lib/i18n';
import { fetchMyLoyalty, fetchMyProfile } from './profile-api';
import {
  TIER_KEYS,
  loyaltyRows,
  profileRows,
  tierMismatch,
  type LoyaltyRow,
} from './profile-model';

const CELL = { padding: '4px 12px 4px 0', textAlign: 'left' } as const;

const PROFILE_KEYS: Readonly<
  Record<'name' | 'phone' | 'email' | 'created' | 'consent', CustomerMessageKey>
> = {
  name: 'guest.profile.name',
  phone: 'guest.profile.phone',
  email: 'guest.profile.email',
  created: 'guest.profile.created',
  consent: 'guest.profile.consent',
};

const LOYALTY_KEYS: Readonly<Record<LoyaltyRow['key'], CustomerMessageKey>> = {
  points: 'guest.profile.points',
  stays12: 'guest.profile.stays12',
  staysTotal: 'guest.profile.staysTotal',
};

function ProfileCard({ guest }: { guest: GuestSummary }): ReactElement {
  return (
    <table data-testid="profile-card">
      <caption style={{ textAlign: 'left', paddingBottom: 4 }}>{t('guest.profile.title')}</caption>
      <tbody>
        {profileRows(guest, t('guest.profile.dash')).map((row) => (
          <tr key={row.key}>
            <th scope="row" style={CELL}>
              {t(PROFILE_KEYS[row.key])}
            </th>
            <td style={CELL}>
              {row.key === 'created'
                ? formatDateTimeVn(row.value)
                : row.key === 'consent'
                  ? t(row.value === 'yes' ? 'guest.profile.consentYes' : 'guest.profile.consentNo')
                  : row.value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
    <section
      data-testid="profile-loyalty"
      aria-labelledby="profile-loyalty-title"
      style={{ display: 'grid', gap: 'var(--space-s2, 8px)' }}
    >
      <h2 id="profile-loyalty-title" style={{ margin: 0 }}>
        {t('guest.profile.loyalty.title')}
      </h2>
      <p style={{ margin: 0 }} data-testid="profile-tier">
        {t('guest.profile.tier', { tier: t(TIER_KEYS[guest.loyaltyTier]) })}
      </p>
      <table data-testid="profile-loyalty-table">
        <tbody>
          {loyaltyRows(loyalty).map((row) => (
            <tr key={row.key}>
              <th scope="row" style={CELL}>
                {t(LOYALTY_KEYS[row.key])}
              </th>
              <td style={CELL}>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!tierMismatch(guest, loyalty) ? null : (
        <p role="status" data-testid="profile-mismatch" style={{ margin: 0 }}>
          {t('guest.profile.mismatch')}
        </p>
      )}
    </section>
  );
}

export function ProfileScreen(): ReactElement {
  const session = useMemo(() => createSessionClient({ kind: 'guest' }), []);
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [guest, setGuest] = useState<GuestSummary | null>(null);
  const [loyalty, setLoyalty] = useState<GuestLoyalty | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => () => session.dispose(), [session]);

  const load = useCallback(async (): Promise<void> => {
    setAlert(null);
    setState({ kind: 'loading' });
    try {
      const [profile, points] = await Promise.all([
        fetchMyProfile(session),
        fetchMyLoyalty(session),
      ]);
      setGuest(profile);
      setLoyalty(points);
      setNotFound(false);
      setState({ kind: 'ready' });
    } catch (caught) {
      const code = isApiError(caught) ? caught.code : undefined;
      const status = isApiError(caught) ? caught.status : undefined;
      const action = mapErrorToUiAction({ code, status });
      setGuest(null);
      setLoyalty(null);
      setState({ kind: 'ready' });
      if (action === 'reauth' || action === 'request-access') {
        setForbidden(true);
        return;
      }
      if (action === 'not-found') {
        setNotFound(true);
        return;
      }
      setAlert(t(actionMessageKey(action)));
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  if (forbidden) return <AccessDeniedPanel backHref="/" />;

  return (
    <section
      data-testid="profile-screen"
      style={{ display: 'grid', gap: 'var(--space-s3, 12px)', padding: 'var(--space-s4, 16px) 0' }}
    >
      <h1 style={{ margin: 0 }}>{t('guest.profile.heading')}</h1>
      <StateSurface state={state}>
        {alert === null ? null : (
          <p role="alert" data-testid="profile-alert" style={{ margin: 0 }}>
            {alert}
          </p>
        )}
        {notFound ? (
          <p role="status" data-testid="profile-not-found" style={{ margin: 0 }}>
            {t('guest.profile.notFound')}
          </p>
        ) : null}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" data-testid="profile-reload" onClick={() => void load()}>
            {t('guest.profile.reload')}
          </button>
        </div>
        {guest === null || loyalty === null ? null : (
          <>
            <ProfileCard guest={guest} />
            <LoyaltyPanel guest={guest} loyalty={loyalty} />
          </>
        )}
        <p style={{ margin: 0 }} data-testid="profile-cut">
          {t('guest.profile.cut')}
        </p>
      </StateSurface>
    </section>
  );
}
