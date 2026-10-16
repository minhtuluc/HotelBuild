'use client';

import { useSearchParams } from 'next/navigation';
import type { ReactElement } from 'react';
import { StateSurface } from '@pinehill/ui-web';
import { t } from '../../../lib/i18n';
import { createFixture, isStateSlug } from './fixtures';

export function StatesClient(): ReactElement {
  const params = useSearchParams();
  const requested = params.get('state') ?? 'loading';
  const slug = isStateSlug(requested) ? requested : 'loading';
  return (
    <StateSurface state={createFixture(slug)}>
      <form>
        <label htmlFor="adults">{t('guest.states.adults')}</label>
        <input id="adults" name="adults" type="number" defaultValue={2} />
        <button type="button">{t('guest.states.continue')}</button>
      </form>
    </StateSurface>
  );
}
