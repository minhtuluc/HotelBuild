import { Suspense, type ReactElement } from 'react';
import { StatesClient } from './states-client';

export default function StatesPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <StatesClient />
    </Suspense>
  );
}
