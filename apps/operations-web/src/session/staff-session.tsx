'use client';

/**
 * Khung phiên nhân viên: chặn nội dung cho tới khi cổng (`useStaffGate`) cho qua, rồi cấp ngữ cảnh
 * `useStaffSession()` / `useWorkingProperty()` cho các màn phía sau. Thanh đầu trang (cơ sở đang làm việc,
 * đổi cơ sở, đăng xuất) chỉ hiện ở khu vực `app`.
 */
import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import type { ApiClient } from '@pinehill/api-client';
import type { UserMe } from '@pinehill/contracts';
import { color, space, touchTargetPx } from '@pinehill/ui-web';
import type { GateStage, PropertyOption } from './gate';
import { authText as text } from './messages';
import { useStaffGate, type StaffGate } from './use-staff-gate';

export interface StaffSessionValue {
  readonly me: UserMe;
  /** Cơ sở được phép chọn (đã lọc theo phạm vi máy chủ cấp). */
  readonly properties: readonly PropertyOption[];
  /** Cơ sở đang làm việc; `null` ở các màn trước khi chọn (đổi mật khẩu, chọn cơ sở). */
  readonly propertyId: string | null;
  readonly selectProperty: (propertyId: string) => void;
  readonly changePassword: StaffGate['changePassword'];
  readonly logout: () => Promise<void>;
  readonly client: ApiClient;
}

const StaffSessionContext = createContext<StaffSessionValue | null>(null);

export function useStaffSession(): StaffSessionValue {
  const value = useContext(StaffSessionContext);
  if (value === null) throw new Error('useStaffSession phải nằm trong StaffSessionBoundary');
  return value;
}

/** Hook chung cho các màn: cơ sở đang làm việc để truyền làm `propertyId` (QĐ-03 quyết định 9). */
export function useWorkingProperty(): {
  propertyId: string | null;
  setProperty: (propertyId: string) => void;
} {
  const { propertyId, selectProperty } = useStaffSession();
  return { propertyId, setProperty: selectProperty };
}

const BUTTON = {
  minHeight: touchTargetPx,
  border: `1px solid ${color.borderStrong}`,
  borderRadius: 6,
  padding: `0 ${space.s3}px`,
  background: color.surface,
  color: color.text,
} as const;

function Notice({
  role,
  children,
  testId,
}: {
  role: 'status' | 'alert';
  children: ReactNode;
  testId: string;
}): ReactElement {
  return (
    <section
      role={role}
      data-testid={testId}
      style={{ padding: space.s6, display: 'grid', gap: space.s3 }}
    >
      {children}
    </section>
  );
}

function PropertySwitcher({ value }: { value: StaffSessionValue }): ReactElement | null {
  const { properties, propertyId, selectProperty, me } = value;
  if (propertyId === null) return null;
  if (properties.length <= 1 && me.role !== 'OWNER') {
    const only = properties.find((property) => property.id === propertyId);
    return (
      <span data-testid="staff-property">
        {text('barProperty')}: {only?.name ?? propertyId}
      </span>
    );
  }
  return (
    <label style={{ display: 'inline-flex', gap: space.s2, alignItems: 'center' }}>
      {text('barProperty')}
      <select
        data-testid="staff-property-select"
        value={propertyId}
        onChange={(event) => {
          selectProperty(event.target.value);
        }}
        style={{ ...BUTTON, padding: space.s2 }}
      >
        {properties.map((property) => (
          <option key={property.id} value={property.id}>
            {property.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function StaffBar({ value }: { value: StaffSessionValue }): ReactElement {
  return (
    <div
      role="group"
      aria-label={text('barLabel')}
      data-testid="staff-bar"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: space.s3,
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: `${space.s2}px ${space.s4}px`,
        borderBottom: `1px solid ${color.border}`,
      }}
    >
      <PropertySwitcher value={value} />
      <span style={{ display: 'inline-flex', gap: space.s3, alignItems: 'center' }}>
        <span data-testid="staff-user">
          {text('barUser', { name: value.me.fullName, role: value.me.role })}
        </span>
        <button
          type="button"
          data-testid="staff-logout"
          style={BUTTON}
          onClick={() => {
            void value.logout();
          }}
        >
          {text('signOut')}
        </button>
      </span>
    </div>
  );
}

export function StaffSessionBoundary({
  stage,
  children,
}: {
  stage: GateStage;
  children: ReactNode;
}): ReactElement {
  const gate = useStaffGate(stage);
  const { phase } = gate;
  if (phase.kind === 'checking')
    return (
      <Notice role="status" testId="staff-checking">
        <p aria-busy="true" style={{ margin: 0 }}>
          {text('checking')}
        </p>
      </Notice>
    );
  if (phase.kind === 'error')
    return (
      <Notice role="alert" testId="staff-check-failed">
        <p style={{ margin: 0 }}>{text('checkFailed')}</p>
        <button type="button" style={{ ...BUTTON, justifySelf: 'start' }} onClick={gate.retry}>
          {text('retry')}
        </button>
      </Notice>
    );
  if (phase.kind === 'none')
    return (
      <Notice role="alert" testId="staff-no-property">
        <p style={{ margin: 0 }}>{text('propertyNone')}</p>
        <button
          type="button"
          style={{ ...BUTTON, justifySelf: 'start' }}
          onClick={() => {
            void gate.logout();
          }}
        >
          {text('signOut')}
        </button>
      </Notice>
    );
  const value: StaffSessionValue = {
    me: phase.me,
    properties: phase.properties,
    propertyId: phase.propertyId,
    selectProperty: gate.selectProperty,
    changePassword: gate.changePassword,
    logout: gate.logout,
    client: gate.client,
  };
  return (
    <StaffSessionContext.Provider value={value}>
      {stage === 'app' ? <StaffBar value={value} /> : null}
      {children}
    </StaffSessionContext.Provider>
  );
}
