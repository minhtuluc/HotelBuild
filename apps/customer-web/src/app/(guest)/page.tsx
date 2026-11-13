import type { ReactElement } from 'react';
import Link from 'next/link';
import { formatMoney } from '@pinehill/ui-web';
import { webEnv } from '../../config';
import { t } from '../../lib/i18n';
import {
  BOOKING_STEPS,
  CABIN_CLASSES,
  FAQ,
  FARE_FACTORS,
  FARE_PLANS,
  SAMPLE_TICKET,
  STATIONS,
  type FarePlan,
} from '../../content/landing-content';
import { POSTERS } from '../../components/station-posters';
import { Photo } from '../../components/photo';
import { ALL_PHOTO_SLOTS, slotById } from '../../content/photo-slots';
import { availablePhotos } from '../../lib/photos';
import { ApiProbe } from './api-probe';
import { SearchBlock } from './search/search-block';

/** Trang chủ là tuyến động vì đọc cấu hình API ở thời điểm gọi (kiến trúc §7.5). */
export const dynamic = 'force-dynamic';

function HeroIntro(): ReactElement {
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
function RouteMap(): ReactElement {
  return (
    <ol className="ph-route" aria-label={t('guest.route.title')}>
      {STATIONS.map((station) => (
        <li key={station.code} className="ph-route-stop">
          <a href={`#ga-${station.code}`}>
            <span className="ph-route-dot" aria-hidden="true" />
            <span className="ph-route-code">{station.code}</span>
            <span className="ph-route-name">{station.name}</span>
            <span className="ph-route-meta">{station.altitude}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

/** Ảnh đang có (mã ô → đường dẫn) và cờ xem trước khung ô ảnh. */
interface PhotoContext {
  readonly found: Readonly<Record<string, string>>;
  readonly preview: boolean;
}

function slotPhoto(ctx: PhotoContext, id: string, fallback?: ReactElement, className?: string) {
  return (
    <Photo
      slot={slotById(id)}
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

function Stations({ photos }: { photos: PhotoContext }): ReactElement {
  return (
    <section className="ph-band ph-band-paper" aria-labelledby="route-title" id="tuyen">
      <div className="ph-band-inner">
        <header className="ph-section-head">
          <h2 id="route-title">{t('guest.route.title')}</h2>
          <p>{t('guest.route.lede')}</p>
        </header>
        <RouteMap />
        <div className="ph-stations">
          {STATIONS.map((station, index) => {
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
        <p className="ph-fineprint">{t('guest.route.illustrative')}</p>
      </div>
    </section>
  );
}

function Classes({ photos }: { photos: PhotoContext }): ReactElement {
  return (
    <section className="ph-band ph-band-ticket" aria-labelledby="classes-title" id="hang-phong">
      <div className="ph-band-inner">
        <header className="ph-section-head">
          <h2 id="classes-title">{t('guest.classes.title')}</h2>
          <p>{t('guest.classes.lede')}</p>
        </header>
        <ul className="ph-classes">
          {CABIN_CLASSES.map((cabin) => (
            <li key={cabin.code} className="ph-class">
              <span className="ph-class-media">
                {slotPhoto(photos, `hang-${cabin.code}`)}
                <span className="ph-class-code">{cabin.code}</span>
              </span>
              <span className="ph-class-title">
                <span className="ph-class-name">{cabin.name}</span>
                <span className="ph-class-cabin">{cabin.cabin}</span>
              </span>
              <span className="ph-class-cap">{cabin.capacity}</span>
              <span className="ph-class-detail">{cabin.detail}</span>
              <a className="ph-class-price" href="#search-block">
                {t('guest.classes.price')} →
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Fare(): ReactElement {
  return (
    <section className="ph-band ph-band-paper" aria-labelledby="fare-title" id="gia">
      <div className="ph-band-inner ph-fare">
        <div>
          <header className="ph-section-head">
            <h2 id="fare-title">{t('guest.fare.title')}</h2>
            <p>{t('guest.fare.lede')}</p>
          </header>
          <ol className="ph-factors">
            {FARE_FACTORS.map((factor) => (
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
              {SAMPLE_TICKET.room} · {SAMPLE_TICKET.checkIn} → {SAMPLE_TICKET.checkOut}
            </span>
          </div>
          <table className="ph-sample-table">
            <tbody>
              {SAMPLE_TICKET.nights.map((night, index) => (
                <tr key={night.date}>
                  <th scope="row">{t('guest.ticket.segment', { n: index + 1 })}</th>
                  <td>
                    {night.weekday} {night.date}
                  </td>
                  <td className="ph-sample-why">{night.why}</td>
                  <td className="ph-sample-amount">{formatMoney(night.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3}>
                  {t('guest.fare.total')}
                </th>
                <td className="ph-sample-amount">{formatMoney(SAMPLE_TICKET.total)}</td>
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
function PlanRow({ plan }: { plan: FarePlan }): ReactElement {
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

function Refunds(): ReactElement {
  return (
    <section className="ph-band ph-band-board" aria-labelledby="refund-title" id="tra-ve">
      <div className="ph-band-inner">
        <header className="ph-section-head">
          <h2 id="refund-title">{t('guest.refund.title')}</h2>
          <p>{t('guest.refund.lede')}</p>
        </header>
        <ul className="ph-plans">
          {FARE_PLANS.map((plan) => (
            <PlanRow key={plan.code} plan={plan} />
          ))}
        </ul>
        <p className="ph-fineprint">{t('guest.refund.note')}</p>
      </div>
    </section>
  );
}

function Steps(): ReactElement {
  return (
    <section className="ph-band ph-band-ticket" aria-labelledby="steps-title" id="cach-dat">
      <div className="ph-band-inner">
        <header className="ph-section-head">
          <h2 id="steps-title">{t('guest.steps.title')}</h2>
        </header>
        <ol className="ph-steps">
          {BOOKING_STEPS.map((step, index) => (
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

function Questions(): ReactElement {
  return (
    <section className="ph-band ph-band-paper" aria-labelledby="faq-title" id="hoi-dap">
      <div className="ph-band-inner ph-faq-wrap">
        <header className="ph-section-head">
          <h2 id="faq-title">{t('guest.faq.title')}</h2>
        </header>
        <div className="ph-faq">
          {FAQ.map((item) => (
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
  const query = await searchParams;
  const photos: PhotoContext = {
    found: availablePhotos(ALL_PHOTO_SLOTS.map((slot) => slot.id)),
    preview: query.anh === '1',
  };
  return (
    <>
      <div className="ph-hero" id="search-anchor">
        <div id="search-block" className="ph-hero-inner" style={{ scrollMarginTop: 16 }}>
          <SearchBlock intro={<HeroIntro />} />
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
