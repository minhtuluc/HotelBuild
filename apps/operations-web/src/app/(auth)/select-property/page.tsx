import { Suspense, type ReactElement } from 'react';
import { StaffSessionBoundary } from '../../../session/staff-session';
import { SelectPropertyForm } from './select-property-form';

/** SCR-14 — chọn cơ sở đang làm việc (QĐ-03 quyết định 9). */
export const dynamic = 'force-dynamic';

export default function SelectPropertyPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <StaffSessionBoundary stage="select-property">
        <SelectPropertyForm />
      </StaffSessionBoundary>
    </Suspense>
  );
}
