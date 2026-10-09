'use client';

/**
 * SCR-01 — khối tìm phòng trên trang chủ khách (UC-INV-02): chọn cơ sở, ngày nhận/trả và số khách,
 * kiểm tại chỗ rồi điều hướng sang SCR-02 (`/search?...`). Danh sách cơ sở lấy từ tuyến công khai
 * `GET /public/properties` qua BFF hành trình (HB-079) — không gọi tuyến nhân viên.
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { createJourneyApiClient } from '@pinehill/web-session/client';
import { listResponseSchema, propertyPublicSummarySchema } from '@pinehill/contracts';
import type { PropertyPublicSummary } from '@pinehill/contracts';
import { StateSurface, type ScreenState } from '@pinehill/ui-web';
import { t } from '../../../lib/i18n';
import { defaultDraft, searchHref, validateSearch, type SearchDraft } from './search-model';

const FIELD_STYLE = { display: 'grid', gap: 4 } as const;

async function fetchProperties(baseUrl: string): Promise<readonly PropertyPublicSummary[]> {
  const client = createJourneyApiClient({
    baseUrl,
    session: { getAccessToken: () => null, onUnauthorized: async () => false },
  });
  const page = await client.request({
    method: 'GET',
    path: '/public/properties',
    decoder: listResponseSchema(propertyPublicSummarySchema),
  });
  return page.data.data;
}

export function SearchBlock(): ReactElement {
  const router = useRouter();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [properties, setProperties] = useState<readonly PropertyPublicSummary[]>([]);
  const [draft, setDraft] = useState<SearchDraft>(() => defaultDraft(new Date()));
  const [readError, setReadError] = useState<unknown>(null);

  const load = useCallback(async (): Promise<void> => {
    setReadError(null);
    setState({ kind: 'loading' });
    try {
      const loaded = await fetchProperties(window.location.origin);
      setProperties(loaded);
      setDraft((current) =>
        current.propertyId === '' && loaded[0] !== undefined
          ? { ...current, propertyId: loaded[0].id }
          : current,
      );
      setState(
        loaded.length === 0
          ? { kind: 'empty', reason: 'noData', canCreate: false }
          : { kind: 'ready' },
      );
    } catch (caught) {
      // Lỗi đọc: giữ nguyên bản nhập, hiện băng lỗi kèm nút thử lại (không hiện "chưa có dữ liệu").
      setReadError(caught);
      setState({ kind: 'ready' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const issues = validateSearch(draft);
    if (issues.length > 0) {
      setState({ kind: 'validationError', details: issues });
      return;
    }
    router.push(searchHref(draft));
  };

  return (
    <section
      data-testid="search-block"
      style={{ display: 'grid', gap: 'var(--space-s3, 12px)', padding: 'var(--space-s4, 16px) 0' }}
    >
      <h2 style={{ margin: 0 }}>{t('guest.search.title')}</h2>
      <p style={{ margin: 0 }}>{t('guest.search.intro')}</p>
      <StateSurface state={state}>
        {readError === null ? null : (
          <div role="alert" style={{ display: 'grid', gap: 'var(--space-s2, 8px)' }}>
            <p style={{ margin: 0 }}>{t('guest.search.error')}</p>
            <button type="button" onClick={() => void load()} style={{ minHeight: 44 }}>
              {t('guest.search.retry')}
            </button>
          </div>
        )}
        {properties.length === 0 ? null : (
          <form
            data-testid="search-form"
            onSubmit={submit}
            style={{
              display: 'flex',
              gap: 'var(--space-s2, 8px)',
              flexWrap: 'wrap',
              alignItems: 'end',
            }}
          >
            <label style={FIELD_STYLE}>
              {t('guest.search.property')}
              <select
                name="propertyId"
                value={draft.propertyId}
                onChange={(event) => setDraft({ ...draft, propertyId: event.target.value })}
              >
                {properties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={FIELD_STYLE}>
              {t('guest.search.checkIn')}
              <input
                type="date"
                name="checkIn"
                value={draft.checkIn}
                onChange={(event) => setDraft({ ...draft, checkIn: event.target.value })}
              />
            </label>
            <label style={FIELD_STYLE}>
              {t('guest.search.checkOut')}
              <input
                type="date"
                name="checkOut"
                value={draft.checkOut}
                onChange={(event) => setDraft({ ...draft, checkOut: event.target.value })}
              />
            </label>
            <label style={FIELD_STYLE}>
              {t('guest.search.adults')}
              <input
                type="number"
                name="adults"
                min={1}
                max={10}
                value={draft.adults}
                onChange={(event) => setDraft({ ...draft, adults: event.target.value })}
              />
            </label>
            <label style={FIELD_STYLE}>
              {t('guest.search.children')}
              <input
                type="number"
                name="children"
                min={0}
                max={6}
                value={draft.children}
                onChange={(event) => setDraft({ ...draft, children: event.target.value })}
              />
            </label>
            <button type="submit" style={{ minHeight: 44 }}>
              {t('guest.search.submit')}
            </button>
          </form>
        )}
      </StateSurface>
    </section>
  );
}
