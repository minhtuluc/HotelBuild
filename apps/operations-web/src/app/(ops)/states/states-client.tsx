'use client';

import { useSearchParams } from 'next/navigation';
import type { ReactElement } from 'react';
import { StateSurface } from '@pinehill/ui-web';
import {
  OPS_COMPACT_BTN_STYLE,
  OPS_FIELD_LABEL_STYLE,
  OPS_FILTER_ROW_STYLE,
  OPS_PAGE_STYLE,
} from '../../../components/editorial-styles';
import { t } from '../../../lib/i18n';
import { createFixture, isStateSlug } from './fixtures';

export function StatesClient(): ReactElement {
  const params = useSearchParams();
  const requested = params.get('state') ?? 'loading';
  const slug = isStateSlug(requested) ? requested : 'loading';
  return (
    <section style={OPS_PAGE_STYLE}>
      <StateSurface state={createFixture(slug)}>
        <form className="ph-card ph-filter-row" style={OPS_FILTER_ROW_STYLE}>
          <label htmlFor="note" style={OPS_FIELD_LABEL_STYLE}>
            {t('ops.states.note')}
            <input id="note" name="note" type="text" />
          </label>
          <button type="button" className="ph-btn-primary" style={OPS_COMPACT_BTN_STYLE}>
            {t('ops.states.save')}
          </button>
        </form>
      </StateSurface>
    </section>
  );
}
