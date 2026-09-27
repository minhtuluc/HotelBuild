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
        <label htmlFor="note">Ghi chú xử lý</label>
        <input id="note" name="note" type="text" />
        <button type="button">Lưu</button>
      </form>
    </StateSurface>
  );
}
