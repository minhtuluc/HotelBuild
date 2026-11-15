import type { ReactElement } from 'react';
import { LocaleLink as Link } from '../../components/locale-link';
import { webEnv } from '../../config';
import { serverTranslators } from '../../i18n/server';
import { money } from '../../i18n/format';
import type { Locale } from '../../i18n/locales';
import { landingContent, type FarePlan } from '../../content/landing-content';
import { POSTERS } from '../../components/station-posters';
import { Photo } from '../../components/photo';
import { ALL_PHOTO_SLOTS, slotById } from '../../content/photo-slots';
import { availablePhotos } from '../../lib/photos';
import { RouteMap } from '../../components/content/route-map';
import { propertyPageKey } from '../../content/property-pages';
import { StationMore } from '../../components/content/station-more';
import { roomTypePageKey } from '../../content/room-type-pages';
import { ApiProbe } from './api-probe';
import { SearchBlock } from './search/search-block';

/** Trang chủ là tuyến động vì đọc cấu hình API ở thời điểm gọi (kiến trúc §7.5). */
export const dynamic = 'force-dynamic';

async function HeroIntro(): Promise<ReactElement> {
  const { t } = await serverTranslators();
  return (
    <div className="ph-hero-copy">
      <h1 className="ph-hero-title">
        <span>{t('guest.home.titleLine1')}</span>
        <span>{t('guest.home.titleLine2')}</span>
      </h1>
      <p className="ph-hero-lede">{t('guest.home.intro')}</p>
    </div>
  );
}

/** Sơ đồ tuyến: ba ga trên một đường, độ cao ghi cạnh mỗi ga. */
/** Ảnh đang có (mã ô → đường dẫn) và cờ xem trước khung ô ảnh. */
interface PhotoContext {
  readonly found: Readonly<Record<string, string>>;
  readonly preview: boolean;
  readonly locale: Locale;
}

function slotPhoto(ctx: PhotoContext, id: string, fallback?: ReactElement, className?: string) {
  return (
    <Photo
      slot={slotById(id)}
      locale={ctx.locale}
      src={ctx.found[id]}
      preview={ctx.preview}
      fallback={fallback}
      className={className}
    />
  );
}

function hasPhoto(ctx: PhotoContext, ...ids: readonly string[]): boolean {
  return ctx.preview || ids.some((id) => ctx.found[id] !== undefined);
}

async function Stations({ photos }: { photos: PhotoContext }): Promise<ReactElement> {
  const { t, locale } = await serverTranslators();
  const content = landingContent(locale);
  return (
    <section data-reveal className="ph-band ph-band-paper" aria-labelledby="route-title" id="tuyen">
      <div className="ph-band-inner">
        <header className="ph-section-head">
          <h2 id="route-title">{t('guest.route.title')}</h2>
          <p>{t('guest.route.lede')}</p>
        </header>
        <RouteMap
          stations={content.stations}
          label={t('guest.route.title')}
          hrefFor={(code) => `#ga-${code}`}
        />
        <div className="ph-stations">
          {content.stations.map((station, index) => {
            const Poster = POSTERS[station.code];
            return (
              <article
                key={station.code}
                id={`ga-${station.code}`}
                className="ph-station"
                data-flip={index % 2 === 1 ? 'true' : 'false'}
              >
                <figure className="ph-poster">
                  {slotPhoto(
                    photos,
                    `ga-${station.code}-poster`,
                    Poster === undefined ? undefined : <Poster />,
                    'ph-poster-art',
                  )}
                  <figcaption className="ph-poster-title">
                    <span>{station.name}</span>
                    <small>{station.kind}</small>
                  </figcaption>
                </figure>
                <div className="ph-station-body">
                  <p className="ph-station-code" aria-hidden="true">
                    {station.code}
                  </p>
                  <h3>{station.name}</h3>
                  <dl className="ph-station-facts">
                    <div>
                      <dt>{t('guest.route.altitude')}</dt>
                      <dd>{station.altitude}</dd>
                    </div>
                    <div>
                      <dt>{t('guest.route.climate')}</dt>
                      <dd>{station.climate}</dd>
                    </div>
                    <div>
                      <dt>{t('guest.route.best')}</dt>
                      <dd>{station.bestMonths}</dd>
                    </div>
                    <div>
                      <dt>{t('guest.route.getThere')}</dt>
                      <dd>{station.getThere}</dd>
                    </div>
                  </dl>
                  <p className="ph-station-note">{station.note}</p>
                  <StationMore code={station.code} name={station.name} />
                  {hasPhoto(photos, `ga-${station.code}-phong`, `ga-${station.code}-canh`) ? (
                    <div className="ph-station-shots">
                      {slotPhoto(photos, `ga-${station.code}-phong`)}
                      {slotPhoto(photos, `ga-${station.code}-canh`)}
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

async function Classes({ photos }: { photos: PhotoContext }): Promise<ReactElement> {
  const { t, locale } = await serverTranslators();
  const content = landingContent(locale);
  return (
    <section
      data-reveal
      className="ph-band ph-band-ticket"
      aria-labelledby="classes-title"
      id="hang-phong"
    >
      <div className="ph-band-inner">
        <header className="ph-section-head">
          <h2 id="classes-title">{t('guest.classes.title')}</h2>
          <p>{t('guest.classes.lede')}</p>
        </header>
        <ul className="ph-classes">
          {content.cabinClasses.map((cabin) => (
            <li key={cabin.code} className="ph-class">
              <span className="ph-class-media">
                {slotPhoto(photos, `hang-${cabin.code}`)}
                <span className="ph-class-code">{cabin.code}</span>
              </span>
              <span className="ph-class-title">
                <span className="ph-class-name">
                  {roomTypePageKey(cabin.code) === undefined ? (
                    cabin.name
                  ) : (
                    <Link href={`/room-types/${cabin.code}`}>{cabin.name}</Link>
                  )}
                </span>
                <span className="ph-class-cabin">{cabin.cabin}</span>
              </span>
              <span className="ph-class-cap">{cabin.capacity}</span>
              <span className="ph-class-detail">{cabin.detail}</span>
              <a className="ph-class-price" href="#search-block">
                {t('guest.classes.price')}{' '}
                <span className="ph-arrow" aria-hidden="true">
                  →
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

async function Fare(): Promise<ReactElement> {
  const { t, locale } = await serverTranslators();
  const content = landingContent(locale);
  return (
    <section data-reveal className="ph-band ph-band-paper" aria-labelledby="fare-title" id="gia">
      <div className="ph-band-inner ph-fare">
        <div>
          <header className="ph-section-head">
            <h2 id="fare-title">{t('guest.fare.title')}</h2>
            <p>{t('guest.fare.lede')}</p>
          </header>
          <ol className="ph-factors">
            {content.fareFactors.map((factor) => (
              <li key={factor.label}>
                <strong>{factor.label}</strong>
                <span>{factor.hint}</span>
              </li>
            ))}
          </ol>
        </div>
        <figure className="ph-sample">
          <div className="ph-sample-head">
            <span>{t('guest.fare.sampleTitle')}</span>
            <span>
              {content.sampleTicket.room} · {content.sampleTicket.checkIn} →{' '}
              {content.sampleTicket.checkOut}
            </span>
          </div>
          <table className="ph-sample-table">
            <tbody>
              {content.sampleTicket.nights.map((night, index) => (
                <tr key={night.date}>
                  <th scope="row" className="ph-sample-seg">
                    {t('guest.ticket.segment', { n: index + 1 })}
                  </th>
                  <td className="ph-sample-date">
                    {night.weekday} {night.date}
                  </td>
                  <td className="ph-sample-why">{night.why}</td>
                  <td className="ph-sample-amount">{money(night.amount, locale)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3}>
                  {t('guest.fare.total')}
                </th>
                <td className="ph-sample-amount">{money(content.sampleTicket.total, locale)}</td>
              </tr>
            </tfoot>
          </table>
          <span
            className="ph-sample-overprint"
            aria-hidden="true"
            data-label={t('guest.fare.sampleTitle')}
          />
          <figcaption>{t('guest.fare.sampleNote')}</figcaption>
        </figure>
      </div>
    </section>
  );
}

/** Một gói giá: thanh chia theo mốc giờ, mốc xa nhất bên trái, giờ nhận phòng bên phải. */
async function PlanRow({ plan }: { plan: FarePlan }): Promise<ReactElement> {
  const { t } = await serverTranslators();
  return (
    <li className="ph-plan">
      <div className="ph-plan-name">
        <strong>{plan.name}</strong>
        <span>
          {plan.code} · {plan.deposit}
        </span>
      </div>
      <ol className="ph-plan-steps">
        {plan.steps.map((step) => (
          <li
            key={step.label}
            className="ph-plan-step"
            data-level={
              step.refundPercent >= 100 ? 'full' : step.refundPercent > 0 ? 'half' : 'none'
            }
          >
            <span className="ph-plan-when">{step.label}</span>
            <span className="ph-plan-refund">
              {t('guest.refund.percent', { percent: step.refundPercent })}
            </span>
            {step.firstNightCharge ? (
              <span className="ph-plan-charge">{t('guest.refund.firstNight')}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </li>
  );
}

async function Refunds(): Promise<ReactElement> {
  const { t, locale } = await serverTranslators();
  const content = landingContent(locale);
  return (
    <section
      data-reveal
      className="ph-band ph-band-board"
      aria-labelledby="refund-title"
      id="tra-ve"
    >
      <div className="ph-band-inner">
        <header className="ph-section-head">
          <h2 id="refund-title">{t('guest.refund.title')}</h2>
          <p>{t('guest.refund.lede')}</p>
        </header>
        <ul className="ph-plans">
          {content.farePlans.map((plan) => (
            <PlanRow key={plan.code} plan={plan} />
          ))}
        </ul>
        <p className="ph-fineprint">{t('guest.refund.note')}</p>
      </div>
    </section>
  );
}

async function Steps(): Promise<ReactElement> {
  const { t, locale } = await serverTranslators();
  const content = landingContent(locale);
  return (
    <section
      data-reveal
      className="ph-band ph-band-ticket"
      aria-labelledby="steps-title"
      id="cach-dat"
    >
      <div className="ph-band-inner">
        <header className="ph-section-head">
          <h2 id="steps-title">{t('guest.steps.title')}</h2>
        </header>
        <ol className="ph-steps">
          {content.bookingSteps.map((step, index) => (
            <li key={step.title} className="ph-step-card">
              <span className="ph-step-no" aria-hidden="true">
                {index + 1}
              </span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

async function Questions(): Promise<ReactElement> {
  const { t, locale } = await serverTranslators();
  const content = landingContent(locale);
  return (
    <section data-reveal className="ph-band ph-band-paper" aria-labelledby="faq-title" id="hoi-dap">
      <div className="ph-band-inner ph-faq-wrap">
        <header className="ph-section-head">
          <h2 id="faq-title">{t('guest.faq.title')}</h2>
        </header>
        <div className="ph-faq">
          {content.faq.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export default async function GuestHomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const { t, locale } = await serverTranslators();
  const query = await searchParams;
  const photos: PhotoContext = {
    found: availablePhotos(ALL_PHOTO_SLOTS.map((slot) => slot.id)),
    preview: query.anh === '1',
    locale,
  };
  return (
    <>
      <div className="ph-hero" id="search-anchor">
        <div id="search-block" className="ph-hero-inner" style={{ scrollMarginTop: 16 }}>
          <SearchBlock
            intro={<HeroIntro />}
            preferredPropertyName={
              typeof query.ga === 'string' ? propertyPageKey(query.ga)?.apiNameIncludes : undefined
            }
          />
        </div>
      </div>

      <section className="ph-lookup" aria-labelledby="lookup-title">
        <div className="ph-lookup-inner">
          <h2 id="lookup-title">{t('guest.home.lookupTitle')}</h2>
          <p>{t('guest.home.lookup')}</p>
          <Link href="/bookings" className="ph-btn">
            {t('guest.home.lookupCta')}
          </Link>
        </div>
      </section>

      <Stations photos={photos} />
      <Classes photos={photos} />
      <Fare />
      <Refunds />
      <Steps />
      <Questions />

      <section className="ph-status" aria-label={t('guest.home.status')}>
        <ApiProbe baseUrl={webEnv().NEXT_PUBLIC_API_BASE_URL} />
      </section>
    </>
  );
}
