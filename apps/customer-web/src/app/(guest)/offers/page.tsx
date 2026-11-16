/**
 * `/offers` — giá theo số đêm và bốn gói giá (HB-311b, CONT-06). Component máy chủ, không đọc API.
 *
 * Chỉ in quy tắc có trong `docs/02` §4.4 (hệ số số đêm, thông số 4 gói) và bậc hoàn của trang chủ. Không mã
 * khuyến mãi, không số tiền, không so sánh với kênh trung gian (Q15). Frontend không tính giá bằng các số này.
 */
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { ChainPageHead, chainMetadata } from '../../../components/content/chain-page';
import { PlanRow } from '../../../components/content/plan-row';
import { LocaleLink as Link } from '../../../components/locale-link';
import { LOS_TIERS, PLAN_FACTS, chainPagesCopy, isPlanCode } from '../../../content/chain-pages';
import { landingContent } from '../../../content/landing-content';
import { searchCtaHref } from '../../../content/property-pages';
import { LOCALE_META } from '../../../i18n/locales';
import { serverTranslators } from '../../../i18n/server';

const PATH = '/offers';

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await serverTranslators();
  return chainMetadata(PATH, locale, chainPagesCopy(locale).offers);
}

export default async function OffersPage(): Promise<ReactElement> {
  const text = await serverTranslators();
  const { t, locale } = text;
  const copy = chainPagesCopy(locale).offers;
  const factor = new Intl.NumberFormat(LOCALE_META[locale].intl, { minimumFractionDigits: 2 });
  return (
    <div>
      <ChainPageHead
        text={text}
        path={PATH}
        title={t('guest.chain.offers.title')}
        lede={copy.summary}
      />
      <section data-reveal className="ph-band ph-band-paper" aria-labelledby="offers-los">
        <div className="ph-band-inner">
          <header className="ph-section-head">
            <h2 id="offers-los">{t('guest.chain.offers.losTitle')}</h2>
            <p>{copy.losBody}</p>
          </header>
          <ol className="ph-los" data-testid="los-tiers">
            {LOS_TIERS.map((tier) => (
              <li key={tier.fromNights} className="ph-los-tier">
                <p className="ph-los-nights">
                  {tier.toNights === null
                    ? t('guest.chain.offers.losFrom', { from: tier.fromNights })
                    : t('guest.chain.offers.losRange', {
                        from: tier.fromNights,
                        to: tier.toNights,
                      })}
                </p>
                <p className="ph-los-factor">
                  {t('guest.chain.offers.losFactor', { factor: factor.format(tier.factor) })}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <section data-reveal className="ph-band ph-band-board" aria-labelledby="offers-plans">
        <div className="ph-band-inner">
          <header className="ph-section-head">
            <h2 id="offers-plans">{t('guest.chain.offers.plansTitle')}</h2>
            <p>{t('guest.refund.lede')}</p>
          </header>
          <ul className="ph-plans">
            {landingContent(locale).farePlans.map((plan) => {
              const facts = isPlanCode(plan.code) ? PLAN_FACTS[plan.code] : undefined;
              return (
                <PlanRow key={plan.code} plan={plan} text={text}>
                  {facts === undefined ? null : (
                    <ul className="ph-plan-facts">
                      <li>{t('guest.chain.offers.minNights', { n: facts.minNights })}</li>
                      <li>
                        {facts.losDiscount
                          ? t('guest.chain.offers.losYes')
                          : t('guest.chain.offers.losNo')}
                      </li>
                      <li>
                        {facts.reschedule === 'free'
                          ? t('guest.chain.offers.rescheduleFree')
                          : t('guest.chain.offers.rescheduleFee')}
                      </li>
                    </ul>
                  )}
                </PlanRow>
              );
            })}
          </ul>
        </div>
      </section>
      <section data-reveal className="ph-band ph-band-ticket" aria-labelledby="offers-terms">
        <div className="ph-band-inner">
          <div className="ph-honest ph-chain-terms">
            <h2 id="offers-terms">{t('guest.chain.offers.termsTitle')}</h2>
            <ul>
              {copy.terms.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <div className="ph-actions ph-content-end">
            <Link href={searchCtaHref(null)} className="ph-btn ph-btn-accent ph-btn-lg">
              {t('guest.station.cta')}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
