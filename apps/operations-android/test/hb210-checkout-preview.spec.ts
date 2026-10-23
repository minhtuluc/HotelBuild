import { isValidElement } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { checkOutPorts, collectPorts, unlockPin } from '../src/stay/ports';
import { DeparturesScreen } from '../src/stay/screen';
import { PinnedWriter } from '../src/stay/writer';
import { call, createHarness } from './ui-harness';
import { apiError, loggedInSession, previewOf, wire, type Wire } from './stay-wire';

vi.mock('react', async (original) =>
  (await import('./ui-harness')).mockReact(await original<typeof import('react')>()),
);
vi.mock('react-native', async () => (await import('./ui-harness')).reactNativeMock);

const ui = createHarness(isValidElement);
const { byId, press, settle, render } = ui;

async function mount(w: Wire): Promise<void> {
  const session = await loggedInSession(w);
  let n = 0;
  const shared = {
    online: async () => w.online,
    createId: () => `key-${++n}`,
    verifyPin: (pin: string, bookingId: string) => unlockPin(session, pin, bookingId),
  };
  ui.setElement(() =>
    DeparturesScreen({
      session,
      createCheckOutWriter: () => new PinnedWriter(checkOutPorts(session, shared)),
      createCollectWriter: () => new PinnedWriter(collectPorts(session, shared)),
      onBack: () => undefined,
    }),
  );
  await settle();
}

async function unlock(): Promise<void> {
  call(byId('pin-input')?.props.onChangeText, '123456');
  await settle();
  press('pin-unlock');
  await settle();
}

beforeEach(() => {
  ui.reset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-22T02:41:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

test('SCR-61 shows the server preview before confirming, as a read: no PIN verified and no write posted', async () => {
  const w = wire();
  await mount(w);
  press('departure-b1');
  await settle();
  expect(w.previews.map((p) => p.body)).toEqual([
    { bookingId: 'b1', lateCheckOut: false, earlyCheckOut: false },
  ]);
  expect(byId('check-out-preview-fee')?.text).toContain('150.000');
  expect(byId('check-out-preview-balance')?.text).toContain('150.000');
  expect(byId('check-out-preview-time')?.text).toContain('giờ VN');
  expect(byId('check-out-preview-time')?.text).toContain('không ràng buộc');
  expect(w.verifies).toEqual([]);
  expect(w.posts).toEqual([]);
});

test("toggling 'early' reloads the preview and never shows the previous selection's number", async () => {
  const w = wire();
  await mount(w);
  press('departure-b1');
  await settle();
  expect(byId('check-out-preview-fee')?.text).toContain('150.000');
  press('check-out-early');
  render();
  expect(byId('check-out-preview-fee')).toBeUndefined();
  expect(byId('check-out-preview-status')?.text).toContain('Đang tải');
  await settle();
  expect(w.previews.map((p) => p.body.earlyCheckOut)).toEqual([false, true]);
  expect(byId('check-out-preview-fee')?.text).toContain('0 ₫');
});

test('a failed preview says there is no number (not 0) and never blocks the PIN flow or the command', async () => {
  const w = wire({ checkOutPreview: () => apiError(500, 'E_SYS_INTERNAL', 'lỗi') });
  await mount(w);
  press('departure-b1');
  await settle();
  expect(byId('check-out-preview-fee')).toBeUndefined();
  expect(byId('check-out-preview-status')?.text).toContain('Chưa có số xem trước');
  expect(byId('check-out-preview-status')?.text).toContain('không phải 0');
  await unlock();
  press('check-out-submit');
  await settle();
  expect(byId('check-out-done')).toBeDefined();
  expect(w.posts).toHaveLength(1);
});

test('offline at open sends no preview request and says it needs network; retry works once online', async () => {
  const w = wire();
  await mount(w);
  w.online = false;
  press('departure-b1');
  await settle();
  expect(w.previews).toEqual([]);
  expect(byId('check-out-preview-status')?.text).toContain('Cần kết nối mạng');
  expect(byId('check-out-preview-fee')).toBeUndefined();
  w.online = true;
  press('check-out-preview-status-retry');
  await settle();
  expect(byId('check-out-preview-fee')?.text).toContain('150.000');
});

test('a preview for another booking is discarded as an error', async () => {
  const w = wire({ checkOutPreview: (_n, body) => previewOf(body, { bookingId: 'other' }) });
  await mount(w);
  press('departure-b1');
  await settle();
  expect(byId('check-out-preview-fee')).toBeUndefined();
  expect(byId('check-out-preview-status')?.text).toContain('Chưa có số xem trước');
});
