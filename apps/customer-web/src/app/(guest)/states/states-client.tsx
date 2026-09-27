'use client';

import { useSearchParams } from 'next/navigation';
import type { ReactElement } from 'react';
import { StateSurface } from '@pinehill/ui-web';
import { createFixture, isStateSlug } from './fixtures';

export function StatesClient(): ReactElement {
  const params = useSearchParams();
  const requested = params.get('state') ?? 'loading';
  const slug = isStateSlug(requested) ? requested : 'loading';
  return (
    <StateSurface state={createFixture(slug)}>
      <form>
        <label htmlFor="adults">Số người lớn</label>
        <input id="adults" name="adults" type="number" defaultValue={2} />
        <button type="button">Tiếp tục</button>
      </form>
    </StateSurface>
  );
}
