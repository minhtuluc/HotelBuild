/**
 * HB-128 A — khoá hành vi xác minh chữ ký của webhook OTA (api.md §5.1, HB-120 `otaWebhookHeadersSchema`).
 *
 * Ba ca, mỗi ca ứng với một dòng tiêu chí nghiệm thu của ticket:
 * - `channel-account-binding` (AC1): `{channel} → ChannelCode`; bí mật/account lấy từ cấu hình adapter
 *   (`system_settings['chan.ota.accounts']`), không tin `{channel}` hay `providerAccountId` trong payload.
 * - `verify-before-dedup` (AC2): HMAC trên raw bytes, kiểm hex/độ dài rồi so sánh constant-time; sai chữ
 *   ký/body bị sửa/chữ ký kênh khác/header sai cấu trúc ⇒ `401 E_CHAN_SIGNATURE_INVALID`, **không** ghi
 *   inbox và không chiếm khoá dedup.
 * - `timestamp-boundary-and-poisoning` (AC3): `|now − t| ≤ 300` nhận, `301` bị 401; sự kiện giả dùng
 *   event ID thật không chiếm khoá của lần gửi hợp lệ sau đó; chữ ký cũ 30 phút bị 401 (TC-CHAN-09).
 *
 * File này là oracle của phase A: nó đỏ vì route thiếu, không vì fixture. Không sửa assertion khi làm B.
 */
import { expect, test } from 'vitest';
import {
  accountOf,
  ack,
  CHANNEL_CODE,
  clock,
  deliver,
  draft,
  errorCode,
  eventId,
  inboxAll,
  inboxOf,
  nowSeconds,
  PROVIDERS,
  signatureOf,
  storedPayload,
} from './fixture.js';

test('channel-account-binding', async () => {
  // Ba kênh duy nhất được ánh xạ; hàng inbox mang ChannelCode đã chuẩn hoá của kênh đó.
  for (const provider of PROVIDERS) {
    const { raw } = draft({ provider, bookingCode: `HB128-${provider.toUpperCase()}-0001` });
    const id = eventId(`binding-${provider}`);
    const response = await deliver({ provider, eventId: id, raw });
    expect(response.status).toBe(202);
    expect(ack(response.body)).toEqual({ duplicate: false, eventId: id });
    const stored = await inboxOf(id);
    expect(stored).toHaveLength(1);
    const row = stored[0]!;
    expect(row.provider).toBe(provider);
    // Account lấy từ cấu hình adapter, không phải từ payload.
    expect(row.provider_account_id).toBe(accountOf(provider).accountId);
    expect(row.status).toBe('PENDING');
    expect(storedPayload(row).channelCode).toBe(CHANNEL_CODE[provider]);
  }

  // Ngoài `booking|agoda|airbnb` không có tuyến nào.
  const unknown = await deliver({
    provider: 'booking',
    eventId: eventId('binding-unknown-channel'),
    raw: draft().raw,
    channel: 'expedia',
  });
  expect(unknown.status).toBe(404);

  // `providerAccountId` trong payload trỏ account khác ⇒ không được dùng để chọn bí mật/scope.
  const secondAccount = accountOf('booking', 1);
  const mismatched = draft({ provider: 'booking', account: secondAccount });
  const mismatchedResponse = await deliver({
    provider: 'booking',
    eventId: eventId('binding-account-mismatch'),
    raw: mismatched.raw,
  });
  expect(mismatchedResponse.status).toBe(401);
  expect(errorCode(mismatchedResponse.body)).toBe('E_CHAN_SIGNATURE_INVALID');

  // Khoá nhà cung cấp của kênh khác không dùng được cho kênh này.
  const agodaAccount = accountOf('agoda');
  const foreign = await deliver({
    provider: 'booking',
    account: agodaAccount,
    eventId: eventId('binding-foreign-key'),
    raw: draft({ provider: 'booking', account: agodaAccount }).raw,
  });
  expect(foreign.status).toBe(401);
  expect(errorCode(foreign.body)).toBe('E_CHAN_SIGNATURE_INVALID');

  // Bí mật không có trong cấu hình adapter cũng không mở được kênh.
  const unconfigured = draft({ provider: 'airbnb' });
  const unconfiguredResponse = await deliver({
    provider: 'airbnb',
    eventId: eventId('binding-unconfigured-secret'),
    raw: unconfigured.raw,
    signature: signatureOf('hb128-not-configured-secret', nowSeconds(), unconfigured.raw),
  });
  expect(unconfiguredResponse.status).toBe(401);

  // Chỉ ba sự kiện hợp lệ ở trên vào inbox.
  const all = await inboxAll();
  expect(all).toHaveLength(3);
  expect(all.map((row) => String(row.provider)).sort()).toEqual([...PROVIDERS].sort());
});

test('verify-before-dedup', async () => {
  const account = accountOf('booking');
  const timestamp = nowSeconds();
  const { raw } = draft({ bookingCode: 'HB128-VBD-0001' });
  const good = signatureOf(account.secret, timestamp, raw);
  const hex = good.slice(good.indexOf('v1=') + 3);

  const rejected: readonly {
    readonly label: string;
    readonly raw: string;
    readonly signature: string;
  }[] = [
    {
      label: 'bí mật sai',
      raw,
      signature: signatureOf('hb128-wrong-secret', timestamp, raw),
    },
    {
      // Chữ ký tính trên body gốc nhưng body gửi đi đã bị sửa.
      label: 'body bị sửa sau khi ký',
      raw: draft({ bookingCode: 'HB128-VBD-0001', amount: 9_999_000 }).raw,
      signature: good,
    },
    {
      label: 'chữ ký của kênh khác',
      raw,
      signature: signatureOf(accountOf('agoda').secret, timestamp, raw),
    },
    { label: 'hex thiếu ký tự', raw, signature: `t=${timestamp},v1=${hex.slice(0, 63)}` },
    { label: 'hex không hợp lệ', raw, signature: `t=${timestamp},v1=${'zz' + hex.slice(2)}` },
    { label: 'thiếu tiền tố t', raw, signature: `v1=${hex}` },
    { label: 'trường thừa', raw, signature: `${good},v2=${hex}` },
    { label: 'timestamp không phải số', raw, signature: `t=abc,v1=${hex}` },
    { label: 'header rỗng', raw, signature: '' },
  ];

  for (const [index, entry] of rejected.entries()) {
    const response = await deliver({
      provider: 'booking',
      eventId: eventId(`vbd-${index}`),
      raw: entry.raw,
      signature: entry.signature,
    });
    expect(response.status, entry.label).toBe(401);
    expect(errorCode(response.body), entry.label).toBe('E_CHAN_SIGNATURE_INVALID');
  }

  // Thiếu hẳn header cũng từ chối trước mọi thứ khác.
  const noSignature = await deliver({
    provider: 'booking',
    eventId: eventId('vbd-omit-signature'),
    raw,
    omitSignature: true,
  });
  expect(noSignature.status).toBe(401);
  const noKey = await deliver({
    provider: 'booking',
    eventId: eventId('vbd-omit-key'),
    raw,
    omitKeyId: true,
  });
  expect(noKey.status).toBe(401);

  // Không có lần từ chối nào chạm inbox.
  expect(await inboxAll()).toHaveLength(0);

  // Verify trước dedup: event ID đã có hàng vẫn 401 (không phải 409) và không đổi bản gốc.
  const storedId = eventId('vbd-stored');
  const storedDraft = draft({ bookingCode: 'HB128-VBD-STORED' });
  const accepted = await deliver({ provider: 'booking', eventId: storedId, raw: storedDraft.raw });
  expect(accepted.status).toBe(202);
  const before = await inboxOf(storedId);
  expect(before).toHaveLength(1);

  const tampered = draft({ bookingCode: 'HB128-VBD-STORED', amount: 9_999_000 });
  const tamperedResponse = await deliver({
    provider: 'booking',
    eventId: storedId,
    raw: tampered.raw,
    signature: signatureOf('hb128-wrong-secret', timestamp, tampered.raw),
  });
  expect(tamperedResponse.status).toBe(401);
  expect(errorCode(tamperedResponse.body)).toBe('E_CHAN_SIGNATURE_INVALID');
  const after = await inboxOf(storedId);
  expect(after).toHaveLength(1);
  expect(after[0]!.payload_hash).toBe(before[0]!.payload_hash);
});

test('timestamp-boundary-and-poisoning', async () => {
  const now = nowSeconds();
  const boundary = [
    { label: 'đúng biên −300', offset: -300, status: 202 },
    { label: 'đúng biên +300', offset: 300, status: 202 },
    { label: 'quá biên −301', offset: -301, status: 401 },
    { label: 'quá biên +301', offset: 301, status: 401 },
  ] as const;

  for (const entry of boundary) {
    const id = eventId(`timestamp-${entry.offset}`);
    const { raw } = draft({ bookingCode: `HB128-TS-${entry.offset}` });
    const response = await deliver({
      provider: 'booking',
      eventId: id,
      raw,
      timestamp: now + entry.offset,
    });
    expect(response.status, entry.label).toBe(entry.status);
    if (entry.status === 202) {
      expect(ack(response.body), entry.label).toEqual({ duplicate: false, eventId: id });
    } else {
      expect(errorCode(response.body), entry.label).toBe('E_CHAN_SIGNATURE_INVALID');
      expect(await inboxOf(id), entry.label).toHaveLength(0);
    }
  }

  // TC-CHAN-09: giữ nguyên chữ ký cũ 30 phút rồi gửi lại ⇒ 401; chữ ký mới cùng body ⇒ 200 duplicate.
  const account = accountOf('booking');
  const replayId = eventId('timestamp-replay');
  const replayDraft = draft({ bookingCode: 'HB128-TS-REPLAY' });
  const staleSignature = signatureOf(account.secret, now, replayDraft.raw);
  const first = await deliver({ provider: 'booking', eventId: replayId, raw: replayDraft.raw });
  expect(first.status).toBe(202);

  clock.value += 30 * 60 * 1000;
  const stale = await deliver({
    provider: 'booking',
    eventId: replayId,
    raw: replayDraft.raw,
    signature: staleSignature,
  });
  expect(stale.status).toBe(401);
  expect(errorCode(stale.body)).toBe('E_CHAN_SIGNATURE_INVALID');

  const fresh = await deliver({ provider: 'booking', eventId: replayId, raw: replayDraft.raw });
  expect(fresh.status).toBe(200);
  expect(ack(fresh.body)).toEqual({ duplicate: true, eventId: replayId });

  // Sự kiện giả dùng event ID thật trước KHÔNG chiếm khoá dedup của lần gửi hợp lệ sau đó.
  const poisonedId = eventId('timestamp-poisoned');
  const poisoned = draft({ bookingCode: 'HB128-TS-POISON', amount: 1_000 });
  const forged = await deliver({
    provider: 'booking',
    eventId: poisonedId,
    raw: poisoned.raw,
    signature: signatureOf('hb128-forged-secret', nowSeconds(), poisoned.raw),
  });
  expect(forged.status).toBe(401);

  const legitimate = draft({ bookingCode: 'HB128-TS-POISON', amount: 2_400_000 });
  const accepted = await deliver({ provider: 'booking', eventId: poisonedId, raw: legitimate.raw });
  expect(accepted.status).toBe(202);
  expect(ack(accepted.body)).toEqual({ duplicate: false, eventId: poisonedId });
  const stored = await inboxOf(poisonedId);
  expect(stored).toHaveLength(1);
  expect(storedPayload(stored[0]!).amount).toBe(2_400_000);
});
