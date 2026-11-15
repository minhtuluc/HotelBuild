'use client';

/**
 * SCR-01 — khối tìm phòng trên trang chủ khách (UC-INV-02): chọn cơ sở, ngày nhận/trả và số khách,
 * kiểm tại chỗ rồi điều hướng sang SCR-02 (`/search?...`). Danh sách cơ sở lấy từ tuyến công khai
 * `GET /public/properties` qua BFF hành trình (HB-079) — không gọi tuyến nhân viên.
 *
 * Trình bày theo thế giới "vé tàu": bảng ga liệt kê cơ sở (ga đến) với giờ nhận/trả do máy chủ trả;
 * tấm vé chính là form; mỗi đêm của kỳ in thành một chặng trên vé. Không có giá ở bước này.
 */
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import type { PropertyPublicSummary } from '@pinehill/contracts';
import { StateSurface, type ScreenState } from '@pinehill/ui-web';
import { useLocale, useT } from '../../../i18n/client';
import { calendarDay, stayNights } from '../../../components/stamps';
import { DateLine } from '../../../components/date-line';
import { defaultDraft, searchHref, validateSearch, type SearchDraft } from './search-model';
import { fetchPublicProperties, initialPropertyId } from './public-properties';

/** Số chặng in tối đa trên vé; kỳ dài hơn in "+n chặng". */
const MAX_SEGMENTS = 6;

/** Bảng ga: mỗi cơ sở một dòng, chữ lật khi tải; bấm "Chọn" để đặt ga đến lên vé. */
function DepartureBoard({
  properties,
  loading,
  selectedId,
  onPick,
}: {
  properties: readonly PropertyPublicSummary[];
  loading: boolean;
  selectedId: string;
  onPick: (id: string) => void;
}): ReactElement {
  const t = useT();
  return (
    <div className="ph-board" data-testid="departure-board">
      <div className="ph-board-head">
        <span>{t('guest.board.title')}</span>
        <span>{t('guest.board.timezone')}</span>
      </div>
      <table className="ph-board-table">
        <caption className="ph-sr-only">{t('guest.board.caption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('guest.board.col.station')}</th>
            <th scope="col">{t('guest.board.col.in')}</th>
            <th scope="col">{t('guest.board.col.out')}</th>
            <th scope="col">
              <span className="ph-sr-only">{t('guest.board.col.action')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {loading
            ? [0, 1, 2].map((row) => (
                <tr key={row} aria-hidden="true">
                  <td className="ph-flap">······</td>
                  <td className="ph-flap">··:··</td>
                  <td className="ph-flap">··:··</td>
                  <td />
                </tr>
              ))
            : properties.map((property, index) => {
                const selected = property.id === selectedId;
                return (
                  <tr key={property.id} data-selected={selected ? 'true' : 'false'}>
                    <td
                      key={selected ? 'picked' : 'idle'}
                      className={selected ? 'ph-flap ph-tick' : 'ph-flap'}
                      style={{ animationDelay: `${index * 90}ms` }}
                    >
                      {property.name}
                    </td>
                    <td className="ph-flap" style={{ animationDelay: `${index * 90 + 40}ms` }}>
                      {property.checkInTime}
                    </td>
                    <td className="ph-flap" style={{ animationDelay: `${index * 90 + 80}ms` }}>
                      {property.checkOutTime}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="ph-board-pick"
                        aria-pressed={selected}
                        onClick={() => {
                          onPick(property.id);
                        }}
                      >
                        {selected ? t('guest.board.picked') : t('guest.board.pick')}
                      </button>
                    </td>
                  </tr>
                );
              })}
        </tbody>
      </table>
    </div>
  );
}

/** Các chặng của kỳ: mỗi đêm một ô in thứ + ngày, đánh số chặng. */
function Segments({ draft }: { draft: SearchDraft }): ReactElement {
  const locale = useLocale();
  const t = useT();
  const nights = stayNights(draft.checkIn, draft.checkOut);
  if (nights === null) {
    return (
      <p className="ph-ticket-note ph-tfield-wide" data-testid="ticket-segments">
        {t('guest.ticket.invalid')}
      </p>
    );
  }
  const hidden = nights.length - MAX_SEGMENTS;
  return (
    <ol
      className="ph-segments"
      data-testid="ticket-segments"
      aria-label={t('guest.ticket.segmentsAria', { nights: nights.length })}
    >
      {nights.slice(0, MAX_SEGMENTS).map((iso, index) => {
        const day = calendarDay(iso, locale);
        return (
          <li key={`${draft.checkIn}-${iso}`} className="ph-segment">
            <span className="ph-segment-no">{t('guest.ticket.segment', { n: index + 1 })}</span>
            <span className="ph-segment-day">{day?.weekday}</span>
            <span className="ph-segment-date">{day?.dayMonth}</span>
          </li>
        );
      })}
      {hidden > 0 ? (
        <li className="ph-segment ph-segment-more">{t('guest.ticket.more', { count: hidden })}</li>
      ) : null}
    </ol>
  );
}

function TicketStub({
  draft,
  property,
}: {
  draft: SearchDraft;
  property: PropertyPublicSummary | undefined;
}): ReactElement {
  const t = useT();
  const nights = stayNights(draft.checkIn, draft.checkOut);
  return (
    <aside className="ph-ticket-stub" aria-label={t('guest.ticket.stubAria')}>
      <span className="ph-stub-label">{t('guest.ticket.stubNights')}</span>
      <span className="ph-stub-number">{nights === null ? '–' : nights.length}</span>
      <span className="ph-stub-label">{t('guest.ticket.stubCheckIn')}</span>
      <span className="ph-stub-value">{property?.checkInTime ?? '–'}</span>
      <a className="ph-stub-link" href="#tra-ve">
        {t('guest.ticket.stubRefund')}
      </a>
    </aside>
  );
}

function Field({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <label className={wide === true ? 'ph-tfield ph-tfield-wide' : 'ph-tfield'}>
      <span className="ph-tfield-label">{label}</span>
      {children}
    </label>
  );
}

export function SearchBlock({
  intro,
  preferredPropertyName,
}: {
  intro?: ReactNode;
  /** Trang ga dẫn về (`/?ga=<slug>`): chọn sẵn cơ sở có tên chứa chuỗi này. */
  preferredPropertyName?: string | undefined;
}): ReactElement {
  const t = useT();
  const router = useRouter();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [properties, setProperties] = useState<readonly PropertyPublicSummary[]>([]);
  const [draft, setDraft] = useState<SearchDraft>(() => defaultDraft(new Date()));
  const [readError, setReadError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<void> => {
    setReadError(null);
    setLoading(true);
    setState({ kind: 'loading' });
    try {
      const loaded = await fetchPublicProperties(window.location.origin);
      setProperties(loaded);
      setDraft((current) =>
        current.propertyId === ''
          ? { ...current, propertyId: initialPropertyId(loaded, preferredPropertyName) }
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
    } finally {
      setLoading(false);
    }
  }, [preferredPropertyName]);

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

  const selectedProperty = properties.find((property) => property.id === draft.propertyId);

  return (
    <section data-testid="search-block" className="ph-depart">
      <div className="ph-depart-left">
        {intro}
        <DepartureBoard
          properties={properties}
          loading={loading}
          selectedId={draft.propertyId}
          onPick={(id) => {
            setDraft({ ...draft, propertyId: id });
          }}
        />
      </div>
      <div className="ph-ticket">
        <div className="ph-ticket-main">
          <div className="ph-ticket-head">
            <h2>{t('guest.search.title')}</h2>
            <span className="ph-ticket-serial">{t('guest.ticket.serial')}</span>
          </div>
          <p className="ph-ticket-note">{t('guest.search.intro')}</p>
          <StateSurface state={state}>
            {readError === null ? null : (
              <div role="alert" className="ph-alert-box">
                <p style={{ margin: 0 }}>{t('guest.search.error')}</p>
                <button type="button" className="ph-btn" onClick={() => void load()}>
                  {t('guest.search.retry')}
                </button>
              </div>
            )}
            {properties.length === 0 ? null : (
              <form data-testid="search-form" onSubmit={submit} className="ph-ticket-form">
                <Field label={t('guest.search.property')} wide>
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
                </Field>
                <Field label={t('guest.search.checkIn')}>
                  <input
                    type="date"
                    name="checkIn"
                    aria-describedby="search-checkIn-line"
                    value={draft.checkIn}
                    onChange={(event) => setDraft({ ...draft, checkIn: event.target.value })}
                  />
                  <DateLine id="search-checkIn-line" iso={draft.checkIn} />
                </Field>
                <Field label={t('guest.search.checkOut')}>
                  <input
                    type="date"
                    name="checkOut"
                    aria-describedby="search-checkOut-line"
                    value={draft.checkOut}
                    onChange={(event) => setDraft({ ...draft, checkOut: event.target.value })}
                  />
                  <DateLine id="search-checkOut-line" iso={draft.checkOut} />
                </Field>
                <Field label={t('guest.search.adults')}>
                  <input
                    type="number"
                    name="adults"
                    min={1}
                    max={10}
                    value={draft.adults}
                    onChange={(event) => setDraft({ ...draft, adults: event.target.value })}
                  />
                </Field>
                <Field label={t('guest.search.children')}>
                  <input
                    type="number"
                    name="children"
                    min={0}
                    max={6}
                    value={draft.children}
                    onChange={(event) => setDraft({ ...draft, children: event.target.value })}
                  />
                </Field>
                <Segments draft={draft} />
                <button type="submit" className="ph-btn-accent ph-ticket-submit">
                  {t('guest.search.submit')}
                </button>
              </form>
            )}
          </StateSurface>
        </div>
        <TicketStub draft={draft} property={selectedProperty} />
      </div>
    </section>
  );
}
