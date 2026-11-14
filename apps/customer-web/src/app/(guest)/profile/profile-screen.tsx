'use client';

/**
 * SCR-13 — hồ sơ khách & điểm (customer web), phần chỉ-đọc theo quyết định chủ dự án ở HB-105.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { createSessionClient } from '@pinehill/web-session/client';
import { isApiError } from '@pinehill/api-client';
import type { GuestLoyalty, GuestSummary } from '@pinehill/contracts';
import {
  AccessDeniedPanel,
  StateSurface,
  actionMessageKey,
  mapErrorToUiAction,
  type ScreenState,
} from '@pinehill/ui-web';
import { useDateTimeVn, useT } from '../../../i18n/client';
import type { CustomerMessageKey } from '../../../i18n/catalogs';
import { fetchMyLoyalty, fetchMyProfile } from './profile-api';
import {
  TIER_KEYS,
  loyaltyRows,
  profileRows,
  tierMismatch,
  type LoyaltyRow,
} from './profile-model';

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
  const fmtTime = useDateTimeVn();
  const t = useT();
  return (
    <div className="ph-table-wrap">
      <table data-testid="profile-card">
        <caption
          style={{
            textAlign: 'start',
            padding: '14px 16px',
            fontFamily: 'var(--font-display)',
            fontSize: 18,
          }}
        >
          {t('guest.profile.title')}
        </caption>
        <tbody>
          {profileRows(guest, t('guest.profile.dash')).map((row) => (
            <tr key={row.key}>
              <th scope="row">{t(PROFILE_KEYS[row.key])}</th>
              <td className="ph-tabular">
                {row.key === 'created'
                  ? fmtTime(row.value)
                  : row.key === 'consent'
                    ? t(
                        row.value === 'yes'
                          ? 'guest.profile.consentYes'
                          : 'guest.profile.consentNo',
                      )
                    : row.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LoyaltyPanel({
  guest,
  loyalty,
}: {
  guest: GuestSummary;
  loyalty: GuestLoyalty;
}): ReactElement {
  const t = useT();
  return (
    <section
      data-testid="profile-loyalty"
      aria-labelledby="profile-loyalty-title"
      className="ph-card"
      style={{ display: 'grid', gap: 14 }}
    >
      <h2 id="profile-loyalty-title" style={{ margin: 0, fontSize: 'var(--text-h2, 18px)' }}>
        {t('guest.profile.loyalty.title')}
      </h2>
      <p
        style={{
          margin: 0,
          fontFamily: 'var(--font-display)',
          fontSize: 20,
          color: 'var(--color-primary)',
        }}
        data-testid="profile-tier"
      >
        {t('guest.profile.tier', { tier: t(TIER_KEYS[guest.loyaltyTier]) })}
      </p>
      <div className="ph-table-wrap">
        <table data-testid="profile-loyalty-table">
          <tbody>
            {loyaltyRows(loyalty).map((row) => (
              <tr key={row.key}>
                <th scope="row">{t(LOYALTY_KEYS[row.key])}</th>
                <td className="ph-tabular" style={{ fontWeight: 500 }}>
                  {row.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!tierMismatch(guest, loyalty) ? null : (
        <p
          role="status"
          data-testid="profile-mismatch"
          className="ph-alert-box"
          style={{ margin: 0 }}
        >
          {t('guest.profile.mismatch')}
        </p>
      )}
    </section>
  );
}

export function ProfileScreen(): ReactElement {
  const t = useT();
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

  if (forbidden)
    return (
      <div className="ph-page-shell">
        <AccessDeniedPanel backHref="/" />
      </div>
    );

  return (
    <section data-testid="profile-screen" className="ph-page-shell">
      <div
        className="ph-page-header"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'end',
          gap: 12,
        }}
      >
        <div>
          <h1 className="ph-page-title">{t('guest.profile.heading')}</h1>
        </div>
        <button
          type="button"
          data-testid="profile-reload"
          className="ph-btn"
          onClick={() => void load()}
        >
          {t('guest.profile.reload')}
        </button>
      </div>
      <StateSurface state={state}>
        {alert === null ? null : (
          <p
            role="alert"
            data-testid="profile-alert"
            className="ph-alert-box"
            style={{ margin: 0 }}
          >
            {alert}
          </p>
        )}
        {notFound ? (
          <p
            role="status"
            data-testid="profile-not-found"
            className="ph-muted-box"
            style={{ margin: 0 }}
          >
            {t('guest.profile.notFound')}
          </p>
        ) : null}
        {guest === null || loyalty === null ? null : (
          <div className="ph-two-col">
            <ProfileCard guest={guest} />
            <LoyaltyPanel guest={guest} loyalty={loyalty} />
          </div>
        )}
        <p className="ph-muted-box" style={{ margin: 0, fontSize: 14 }} data-testid="profile-cut">
          {t('guest.profile.cut')}
        </p>
      </StateSurface>
    </section>
  );
}
