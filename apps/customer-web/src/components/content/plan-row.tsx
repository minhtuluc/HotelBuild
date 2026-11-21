/**
 * Một gói giá: thanh chia theo mốc giờ, mốc xa nhất bên trái, giờ nhận phòng bên phải. Dùng ở dải "Trả vé"
 * của trang chủ và `/offers` (HB-311b). Component máy chủ; `children` là dòng thông số thêm của từng trang.
 */
import type { ReactElement, ReactNode } from 'react';
import type { FarePlan } from '@pinehill/content/landing-content';
import type { Translators } from '../../i18n/translate';

export function PlanRow({
  plan,
  text,
  children,
}: {
  plan: FarePlan;
  text: Translators;
  children?: ReactNode;
}): ReactElement {
  const { t } = text;
  return (
    <li className="ph-plan" data-testid={`plan-${plan.code}`}>
      <div className="ph-plan-name">
        <strong>{plan.name}</strong>
        <span>
          {plan.code} · {plan.deposit}
        </span>
        {children}
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
