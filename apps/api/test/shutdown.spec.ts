import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const apiDir = fileURLToPath(new URL('..', import.meta.url));
const port = 3400 + Math.floor(Math.random() * 300);

async function delay(ms: number): Promise<void> {
  const timer = Promise.withResolvers<void>();
  setTimeout(timer.resolve, ms);
  return await timer.promise;
}

/** AC6: chỉ cần nhận được phản hồi (503 do phụ thuộc chết vẫn tính là đã nối được). */
async function reachable(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/api/v1/system/health`);
    return true;
  } catch {
    return false;
  }
}

describe('tắt êm tiến trình API (AC7)', () => {
  it('SIGTERM đóng server rồi thoát mã 0', async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
      cwd: apiDir,
      env: {
        ...process.env,
        DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/db',
        REDIS_URL: 'redis://127.0.0.1:1',
        JWT_ACCESS_SECRET: 'x'.repeat(32),
        JWT_REFRESH_SECRET: 'y'.repeat(32),
        BUSINESS_TIMEZONE: 'Asia/Ho_Chi_Minh',
        LOG_LEVEL: 'silent',
        PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    let up = false;
    for (let attempt = 0; attempt < 80 && !up; attempt++) {
      up = await reachable(port);
      if (!up) await delay(250);
    }
    expect(up, `server không lên kịp. stderr: ${stderr}`).toBe(true);
    const exited = Promise.withResolvers<number | null>();
    child.on('exit', (code) => exited.resolve(code));
    child.kill('SIGTERM');
    expect(await exited.promise).toBe(0);
  }, 40_000);
});
