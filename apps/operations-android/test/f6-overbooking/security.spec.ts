import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import * as fx from './fixtures';

const PIN = '654321';
const TOKEN = 'synthetic-pin-token-0001';
const SRC = join(__dirname, '../../src/features/f6-overbooking');

async function ready(role: fx.Role = 'FRONT_DESK') {
  const made = fx.flowOf(role);
  made.fake.move.mockResolvedValue({
    view: fx.moveView({ allowedActions: ['APPROVE', 'EXECUTE'] }),
    etag: fx.tag('"3"'),
  });
  await made.flow.load('mv1');
  return made;
}

const everything = (made: Awaited<ReturnType<typeof ready>>): string =>
  JSON.stringify([made.flow.state, made.flow.reader.state, made.flow.writer]);

test('pin_memory_only_and_session_cleanup', async () => {
  const { flow, fake } = await ready();
  flow.askPin('execute');
  await flow.submitPin(PIN);
  // PIN chỉ đi tới pin/verify một lần; mã một lần chỉ đi tới lệnh, không nằm trong state nào.
  expect(fake.verifyPin).toHaveBeenCalledTimes(1);
  expect(fake.verifyPin).toHaveBeenCalledWith(PIN, 'bk-1');
  expect(fake.execute.mock.calls[0]?.[1]).toBe(TOKEN);
  expect(flow.state.command.kind).toBe('done');
  const dump = JSON.stringify([flow.state, flow.reader.state]);
  expect(dump).not.toContain(PIN);
  expect(dump).not.toContain(TOKEN);
  // Sau khi dùng (kết quả chắc chắn) mã bị xoá; lệnh sau phải nhập PIN lại.
  expect(flow.writer.unlocked).toBe(false);
  flow.askPin('execute');
  fake.move.mockResolvedValue({
    view: fx.moveView({ allowedActions: ['EXECUTE'] }),
    etag: fx.tag('"3"'),
  });
  await flow.load('mv1');
  flow.askPin('execute');
  expect(flow.state.pinFor).toBe('execute');
  expect(flow.writer.unlocked).toBe(false);
});

test('pin_memory_only_and_session_cleanup:cleanup paths', async () => {
  // Huỷ ô PIN, đổi phiên/cơ sở, chưa rõ kết quả rồi bỏ: mọi đường đều xoá mã.
  for (const action of ['cancel', 'reset', 'discard'] as const) {
    const made = await ready();
    made.flow.askPin('execute');
    made.fake.execute.mockRejectedValueOnce(fx.timeout());
    await made.flow.submitPin(PIN);
    expect(made.flow.writer.unlocked).toBe(true);
    if (action === 'cancel') made.flow.cancelPin();
    else if (action === 'reset') made.flow.reset();
    else made.flow.discard();
    expect(made.flow.writer.unlocked).toBe(false);
    expect(made.flow.writer.hasPending).toBe(false);
    expect(everything(made)).not.toContain(PIN);
    expect(everything(made)).not.toContain(TOKEN);
  }
  // Rời màn hình: writer bị đóng, không gửi thêm gì.
  const closed = await ready();
  closed.flow.askPin('execute');
  closed.flow.dispose();
  await closed.flow.submitPin(PIN);
  expect(closed.fake.verifyPin).not.toHaveBeenCalled();
});

test('pin_memory_only_and_session_cleanup:lock and expiry', async () => {
  const locked = await ready();
  locked.flow.askPin('execute');
  locked.fake.verifyPin.mockRejectedValueOnce(
    fx.http(403, 'E_AUTH_PIN_LOCKED', { retryAfterSeconds: 900 }),
  );
  await locked.flow.submitPin(PIN);
  expect(locked.flow.state).toMatchObject({ pinMessage: 'locked', lockedFor: 900 });
  expect(locked.fake.execute).not.toHaveBeenCalled();
  expect(locked.flow.writer.unlocked).toBe(false);
  const wrong = await ready();
  wrong.flow.askPin('execute');
  wrong.fake.verifyPin.mockRejectedValueOnce(fx.http(401, 'E_AUTH_PIN_REQUIRED'));
  await wrong.flow.submitPin(PIN);
  expect(wrong.flow.state.pinMessage).toBe('wrong');
  expect(wrong.fake.execute).not.toHaveBeenCalled();
  const expired = await ready();
  expired.flow.askPin('execute');
  expired.fake.verifyPin.mockRejectedValueOnce(fx.http(401, 'E_AUTH_TOKEN_EXPIRED'));
  await expired.flow.submitPin(PIN);
  expect(expired.flow.state.pinMessage).toBe('expired');
  expect(expired.flow.writer.unlocked).toBe(false);
  // Mất mạng: không gửi, không xếp hàng; sai hình dạng: không gọi mạng.
  const offline = await ready();
  offline.flow.askPin('execute');
  offline.fake.online.mockResolvedValue(false);
  await offline.flow.submitPin(PIN);
  expect(offline.flow.state.pinMessage).toBe('offline');
  expect(offline.fake.verifyPin).not.toHaveBeenCalled();
  await offline.flow.submitPin('12');
  expect(offline.flow.state.pinMessage).toBe('shape');
  // PIN của lệnh bị máy chủ đòi lại (E_AUTH_PIN_REQUIRED khi gửi lệnh): xoá mã, không coi là mất phiên.
  const again = await ready();
  again.flow.askPin('execute');
  again.fake.execute.mockRejectedValueOnce(fx.http(401, 'E_AUTH_PIN_REQUIRED'));
  await again.flow.submitPin(PIN);
  expect(again.flow.writer.unlocked).toBe(false);
  expect(again.flow.reader.state.phase).toBe('ready');
});

test('pin_memory_only_and_session_cleanup:no persistence in source', () => {
  // Không lưu PIN/pinToken vào storage, log hay bản nháp: mô-đun F6 không import lưu trữ/ghi log.
  const files = readdirSync(SRC).filter((name) => /\.tsx?$/.test(name));
  expect(files.length).toBeGreaterThan(8);
  for (const name of files) {
    const source = readFileSync(join(SRC, name), 'utf8');
    expect(source, name).not.toMatch(
      /AsyncStorage|SecureStore|expo-secure-store|localStorage|console\./,
    );
    if (name !== 'boot.native.ts') expect(source, name).not.toMatch(/from '\.\.\/\.\.\/storage/);
  }
  // Ô PIN che ký tự và không bật tự điền.
  const pinForm = readFileSync(join(SRC, 'pin-form.tsx'), 'utf8');
  expect(pinForm).toContain('secureTextEntry');
  expect(pinForm).toContain('importantForAutofill="no"');
});
