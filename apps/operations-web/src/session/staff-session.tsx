'use client';

/**
 * Khung phiên nhân viên: chặn nội dung cho tới khi cổng (`useStaffGate`) cho qua, rồi cấp ngữ cảnh
 * `useStaffSession()` / `useWorkingProperty()` cho các màn phía sau. Thanh đầu trang (thương hiệu,
 * ngăn điều hướng phân hệ, cơ sở đang làm việc, đổi cơ sở, đăng xuất) chỉ hiện ở khu vực `app`.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ApiClient } from '@pinehill/api-client';
import type { UserMe } from '@pinehill/contracts';
import { PineHillBrand, color, radius, space, touchTargetPx } from '@pinehill/ui-web';
import type { GateStage, PropertyOption } from './gate';
import { authText as text } from './messages';
import { OpsModuleNav } from './ops-nav';
import { VnClock } from '../components/vn-clock';
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

/**
 * Như `useStaffSession` nhưng trả `null` khi màn được render ngoài khung phiên (test đơn vị, trạng thái
 * demo). Dùng cho gợi ý giao diện theo vai trò; quyền thật vẫn do máy chủ quyết.
 */
export function useOptionalStaffSession(): StaffSessionValue | null {
  return useContext(StaffSessionContext);
}

/** Hook chung cho các màn: cơ sở đang làm việc để truyền làm `propertyId` (QĐ-03 quyết định 9). */
export function useWorkingProperty(): {
  propertyId: string | null;
  setProperty: (propertyId: string) => void;
} {
  const { propertyId, selectProperty } = useStaffSession();
  return { propertyId, setProperty: selectProperty };
}

const START = { justifySelf: 'start' } as const;

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
      style={{
        maxWidth: 540,
        margin: `${space.s8}px auto`,
        padding: space.s6,
        background: color.surface,
        border: `1px solid ${color.border}`,
        borderRadius: radius.sm,
        display: 'grid',
        gap: space.s3,
      }}
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
      <span className="ph-ops-property">
        {text('barProperty')}
        <span data-testid="staff-property" className="ph-ops-property-static">
          {only?.name ?? propertyId}
        </span>
      </span>
    );
  }
  return (
    <label className="ph-ops-property">
      {text('barProperty')}
      <select
        data-testid="staff-property-select"
        value={propertyId}
        onChange={(event) => {
          selectProperty(event.target.value);
        }}
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

/**
 * Khung làm việc: thanh bên (điều hướng phân hệ, luôn hiện trên màn rộng; ngăn kéo trên màn hẹp) và
 * thanh ngữ cảnh phía trên (cơ sở đang làm việc, người dùng, đăng xuất).
 */
function OpsFrame({
  value,
  children,
}: {
  value: StaffSessionValue;
  children: ReactNode;
}): ReactElement {
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!navOpen) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [navOpen]);

  return (
    <div className="ph-ops-frame">
      <aside className="ph-ops-rail" data-open={navOpen ? 'true' : 'false'}>
        <div className="ph-ops-rail-head">
          <Link
            href="/"
            style={{ textDecoration: 'none', display: 'inline-flex', minHeight: touchTargetPx }}
            aria-label={text('navHome')}
          >
            <PineHillBrand tone="dark" compact subtitle={text('brandSubtitle')} />
          </Link>
          <button
            type="button"
            className="ph-btn ph-ops-menu-toggle ph-ops-rail-close"
            onClick={() => {
              setNavOpen(false);
            }}
          >
            {text('navToggleClose')}
          </button>
        </div>
        <OpsModuleNav
          onNavigate={() => {
            setNavOpen(false);
          }}
        />
      </aside>
      <div className="ph-ops-main">
        <header aria-label={text('barLabel')} data-testid="staff-bar" className="ph-ops-topbar">
          <div className="ph-ops-topbar-group">
            <button
              type="button"
              className="ph-btn ph-ops-menu-toggle"
              data-testid="ops-nav-toggle"
              aria-expanded={navOpen}
              aria-controls="ops-module-nav"
              onClick={() => {
                setNavOpen((previous) => !previous);
              }}
            >
              {navOpen ? text('navToggleClose') : text('navToggleOpen')}
            </button>
            <PropertySwitcher value={value} />
          </div>
          <div className="ph-ops-topbar-group">
            <VnClock label={text('clockLabel')} />
            <span data-testid="staff-user" className="ph-ops-user">
              {text('barUser', { name: value.me.fullName, role: value.me.role })}
            </span>
            <button
              type="button"
              data-testid="staff-logout"
              className="ph-btn"
              onClick={() => {
                void value.logout();
              }}
            >
              {text('signOut')}
            </button>
          </div>
        </header>
        <div id="ops-content" style={{ minWidth: 0 }}>
          {children}
        </div>
      </div>
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
        <button type="button" className="ph-btn" style={START} onClick={gate.retry}>
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
          className="ph-btn"
          style={START}
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
      {stage === 'app' ? <OpsFrame value={value}>{children}</OpsFrame> : children}
    </StaffSessionContext.Provider>
  );
}
