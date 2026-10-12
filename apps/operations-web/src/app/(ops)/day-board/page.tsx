import { Suspense } from 'react';
import { webEnv } from '../../../config';
import { defaultDay } from './model';
import { DayBoardScreen } from './screen';
export const dynamic = 'force-dynamic';
export default function DayBoardPage() {
  return (
    <Suspense fallback={null}>
      <DayBoardScreen
        baseUrl={webEnv().NEXT_PUBLIC_API_BASE_URL}
        initialDay={defaultDay(new Date())}
      />
    </Suspense>
  );
}
