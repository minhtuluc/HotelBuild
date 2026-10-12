import { expect, test } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type { SystemSetting } from '@pinehill/contracts';
import {
  SettingsController,
  type SettingsPorts,
} from '../src/app/(ops)/system-settings/controller';
const original: SystemSetting = {
  key: 'pricing.maxDiscountPct',
  value: '20',
  valueType: 'NUMBER',
  description: 'synthetic setting',
  updatedBy: 'owner1',
  updatedAt: '2026-10-12T00:00:00.000Z',
  version: 4,
};
function setup() {
  let current = { ...original };
  let user: { userId: string; role: 'OWNER' | 'MANAGER' } = { userId: 'owner1', role: 'OWNER' };
  let now = 1000;
  let sequence = 0;
  let fail: unknown;
  const data = new Map<string, string>();
  const sends: { key: string; body: unknown; tag: string; stored: boolean }[] = [];
  const ports: SettingsPorts = {
    actor: async () => ({ ...user }),
    list: async () => [current],
    write: async (_settingKey, body, tag, id) => {
      sends.push({ key: id, body, tag, stored: data.size === 1 });
      if (fail) throw fail;
      current = { ...current, value: body.value, version: current.version + 1 };
    },
  };
  const options = {
    ports,
    storage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        data.set(k, v);
      },
      removeItem: (k: string) => {
        data.delete(k);
      },
    },
    createId: () => '7ed2bdb1-c3e0-467f-89e0-' + (++sequence).toString().padStart(12, '0'),
    now: () => now,
  };
  const c = new SettingsController(options);
  return {
    c,
    options,
    ports,
    data,
    sends,
    setFail: (e: unknown) => {
      fail = e;
    },
    clearFail: () => {
      fail = undefined;
    },
    changeServer: () => {
      current = { ...current, value: '22', version: 5 };
    },
    changeOwner: () => {
      user = { userId: 'owner2', role: 'OWNER' };
    },
    revoke: () => {
      user = { ...user, role: 'MANAGER' };
    },
    advance: () => {
      now += 86400000;
    },
  };
}
async function edit(s: ReturnType<typeof setup>) {
  await s.c.load();
  s.c.edit(original.key);
  s.c.draft('25', 'synthetic reason');
}
test('OWNER identity from API is required; MANAGER cannot read configuration or PUT', async () => {
  const s = setup();
  s.revoke();
  let reads = 0;
  s.ports.list = async () => {
    reads++;
    return [original];
  };
  await s.c.load();
  expect(s.c.state.phase).toBe('forbidden');
  expect(reads).toBe(0);
  await s.c.save();
  expect(s.sends).toHaveLength(0);
});
test('persist stable intent before exactly one PUT with original IfMatch, reread reflects success', async () => {
  const s = setup();
  await edit(s);
  await s.c.save();
  expect(s.sends).toHaveLength(1);
  expect(s.sends[0]).toMatchObject({
    tag: '"4"',
    body: { value: '25', reason: 'synthetic reason' },
    stored: true,
  });
  expect(s.c.state.saved).toBe(original.key);
  expect(s.c.state.rows[0]?.value).toBe('25');
  await s.c.save();
  expect(s.sends).toHaveLength(1);
});
test('invalid value or missing reason retains draft and sends nothing', async () => {
  const s = setup();
  await edit(s);
  s.c.draft('bad', '');
  await s.c.save();
  expect(s.sends).toHaveLength(0);
  expect(s.c.state.draft?.value).toBe('bad');
  expect(s.c.state.issues).toEqual(
    expect.arrayContaining([
      { field: 'value', issue: 'NOT_NUMBER' },
      { field: 'reason', issue: 'REQUIRED' },
    ]),
  );
});
test('storage failure prevents sending untrackable PUT', async () => {
  const s = setup();
  s.options.storage.setItem = () => {
    throw Error('storage');
  };
  await edit(s);
  await s.c.save();
  expect(s.sends).toHaveLength(0);
  expect(s.c.state.phase).toBe('error');
});
test('lost response/reload stays unknown even if current value matches; no fresh key without receipt', async () => {
  const s = setup();
  await edit(s);
  s.setFail(Error('network'));
  await s.c.save();
  expect(s.c.state.phase).toBe('unknown');
  const restored = new SettingsController(s.options);
  await restored.load();
  expect(restored.state.phase).toBe('unknown');
  restored.edit(original.key);
  await restored.save();
  expect(s.sends).toHaveLength(1);
  expect(restored.state.referenceId).toBe(s.sends[0]?.key);
});
test('unknown manual replay preserves key/body/IfMatch; only acknowledged response clears intent', async () => {
  const s = setup();
  await edit(s);
  s.setFail(Error('lost'));
  await s.c.save();
  s.clearFail();
  await s.c.retry();
  expect(s.sends).toHaveLength(2);
  expect(s.sends[1]).toEqual(s.sends[0]);
  expect(s.c.state.saved).toBe(original.key);
  expect(s.data.size).toBe(0);
});
test('past24h only lookup/audit is allowed; unknown cannot blindly resend a new or old key', async () => {
  const s = setup();
  await edit(s);
  s.setFail(Error('lost'));
  await s.c.save();
  s.advance();
  await s.c.retry();
  await s.c.load();
  await s.c.save();
  expect(s.sends).toHaveLength(1);
  expect(s.c.state.phase).toBe('unknown');
});
test('412 keeps draft; reading newer version does not automatically change intent, explicit adoption required', async () => {
  const s = setup();
  await edit(s);
  s.setFail(
    new ApiError({
      kind: 'http',
      status: 412,
      code: 'E_GEN_VERSION_CONFLICT',
      message: 'conflict',
    }),
  );
  await s.c.save();
  expect(s.c.state.phase).toBe('conflict');
  expect(s.c.state.draft).toMatchObject({ value: '25', reason: 'synthetic reason', version: 4 });
  s.changeServer();
  s.clearFail();
  await s.c.load();
  expect(s.c.state.phase).toBe('conflict');
  await s.c.save();
  expect(s.sends).toHaveLength(1);
  s.c.acceptVersion();
  await s.c.save();
  expect(s.sends[1]?.tag).toBe('"5"');
  expect(s.sends[1]?.key).not.toBe(s.sends[0]?.key);
});
test('owner changes during prepared write cannot reuse previous owner draft or intent', async () => {
  const s = setup();
  await edit(s);
  s.changeOwner();
  await s.c.save();
  expect(s.sends).toHaveLength(0);
  expect(s.c.state.draft).toBeNull();
  expect(s.c.state.rows).toHaveLength(0);
});
test('role revoked immediately before PUT clears configuration and prevents write', async () => {
  const s = setup();
  await edit(s);
  s.revoke();
  await s.c.save();
  expect(s.sends).toHaveLength(0);
  expect(s.c.state.phase).toBe('forbidden');
  expect(s.c.state.rows).toHaveLength(0);
});
test('known save receipt remains visible if later reload fails; no duplicate write offered', async () => {
  const s = setup();
  await edit(s);
  s.ports.list = async () => {
    throw Error('read unavailable');
  };
  await s.c.save();
  expect(s.c.state.saved).toBe(original.key);
  expect(s.c.state.draft).toBeNull();
  expect(s.sends).toHaveLength(1);
});
test('two concurrent save clicks send one PUT', async () => {
  const s = setup();
  await edit(s);
  let release = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  s.ports.write = async () => {
    s.sends.push({ key: 'sent', body: {}, tag: '"4"', stored: true });
    await waiting;
  };
  const first = s.c.save();
  await s.c.save();
  release();
  await first;
  expect(s.sends).toHaveLength(1);
});
test('failed conflict reread cannot bypass explicit version comparison', async () => {
  const s = setup();
  await edit(s);
  s.setFail(new ApiError({ kind: 'http', status: 412, message: 'conflict' }));
  await s.c.save();
  s.clearFail();
  s.ports.list = async () => {
    throw Error('read unavailable');
  };
  await s.c.load();
  await s.c.save();
  expect(s.sends).toHaveLength(1);
  expect(s.c.state.draft?.version).toBe(4);
});
test('session token change hides cache immediately; same owner retains draft after revalidation', async () => {
  const s = setup();
  await edit(s);
  const promise = s.c.sessionChanged();
  expect(s.c.state.rows).toHaveLength(0);
  expect(s.c.state.draft).toBeNull();
  await promise;
  expect(s.c.state.draft?.value).toBe('25');
  s.changeOwner();
  await s.c.sessionChanged();
  expect(s.c.state.phase).toBe('forbidden');
  expect(s.c.state.rows).toHaveLength(0);
  expect(s.c.state.draft).toBeNull();
});
test('reason is sent verbatim and never silently shortened before persistence', async () => {
  const s = setup();
  await edit(s);
  s.c.draft('25', '  synthetic reason  ');
  await s.c.save();
  expect(s.sends[0]?.body).toEqual({ value: '25', reason: '  synthetic reason  ' });
});
test('stale session revalidation cannot restore draft while newer identity is still unverified', async () => {
  const s = setup();
  await edit(s);
  const resolvers: ((user: { userId: string; role: 'OWNER' }) => void)[] = [];
  s.ports.actor = () => new Promise((resolve) => resolvers.push(resolve));
  const old = s.c.sessionChanged();
  const fresh = s.c.sessionChanged();
  resolvers[0]?.({ userId: 'owner1', role: 'OWNER' });
  await old;
  expect(s.c.state.draft).toBeNull();
  expect(s.c.state.rows).toHaveLength(0);
  resolvers[1]?.({ userId: 'owner2', role: 'OWNER' });
  await fresh;
  expect(s.c.state.phase).toBe('forbidden');
});
