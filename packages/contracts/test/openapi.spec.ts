import { describe, expect, it } from 'vitest';
import { isErrorCode } from '../src/errors.js';
import { buildDocument, CONTRACT_VERSION, serializeDocument } from '../src/openapi/generate.js';

/** Đọc tên tham số của một operation mà không cần ép kiểu. */
function parameterName(parameter: unknown): string | undefined {
  if (typeof parameter !== 'object' || parameter === null) return undefined;
  const candidate = 'name' in parameter ? parameter.name : undefined;
  return typeof candidate === 'string' ? candidate : undefined;
}

function schemeNames(requirement: unknown): string[] {
  if (typeof requirement !== 'object' || requirement === null) return [];
  return Object.keys(requirement);
}

/** Danh sách scheme bảo mật khai cho một operation, hoặc undefined nếu công khai. */
function securityOf(operation: unknown): string[] | undefined {
  if (typeof operation !== 'object' || operation === null) return undefined;
  if (!('security' in operation)) return undefined;
  const { security } = operation;
  if (!Array.isArray(security)) return undefined;
  const names: string[] = [];
  for (const requirement of security) names.push(...schemeNames(requirement));
  return names;
}

function hasParameterNamed(operation: unknown, name: string): boolean {
  if (typeof operation !== 'object' || operation === null) return false;
  const parameters = 'parameters' in operation ? operation.parameters : undefined;
  return (
    Array.isArray(parameters) &&
    parameters.some((parameter: unknown) => parameterName(parameter) === name)
  );
}

type Method = 'get' | 'post' | 'put' | 'delete';

/** Bảng phân loại công khai/cần token theo api.md §2.1 và §6.1. */
const AUTH_OPERATIONS: readonly (readonly [Method, string, 'public' | 'bearer'])[] = [
  ['post', '/api/v1/auth/login', 'public'],
  ['post', '/api/v1/auth/refresh', 'public'],
  ['post', '/api/v1/guest-auth/login', 'public'],
  ['post', '/api/v1/guest-auth/register', 'public'],
  ['post', '/api/v1/guest-auth/refresh', 'public'],
  ['get', '/api/v1/system/health', 'public'],
  ['post', '/api/v1/auth/pin/verify', 'bearer'],
  ['post', '/api/v1/auth/logout', 'bearer'],
  ['put', '/api/v1/users/{userId}/access', 'bearer'],
  ['get', '/api/v1/users', 'bearer'],
  ['post', '/api/v1/users', 'bearer'],
  ['delete', '/api/v1/users/{userId}/pin', 'bearer'],
  ['post', '/api/v1/auth/password', 'bearer'],
  ['put', '/api/v1/auth/pin', 'bearer'],
  ['post', '/api/v1/guest-auth/password-reset/request', 'public'],
  ['post', '/api/v1/guest-auth/password-reset/confirm', 'public'],
];

const WRITE_TARGETS = AUTH_OPERATIONS.filter(([method]) => method !== 'get');

describe('OpenAPI 3.1 sinh từ zod', () => {
  const document = buildDocument();

  function operationAt(method: Method, path: string): unknown {
    const item = document.paths?.[path];
    if (item === undefined) return undefined;
    return item[method];
  }

  it('khai báo phiên bản 3.1 và phiên bản hợp đồng', () => {
    expect(document.openapi).toBe('3.1.0');
    expect(document.info.version).toBe(CONTRACT_VERSION);
  });

  it('có đủ 15 path của F0 + F1 (14 AUTH/guest-auth/users + system/health)', () => {
    expect(Object.keys(document.paths ?? {}).sort()).toEqual(
      [
        '/api/v1/auth/login',
        '/api/v1/auth/logout',
        '/api/v1/auth/password',
        '/api/v1/auth/pin',
        '/api/v1/auth/pin/verify',
        '/api/v1/auth/refresh',
        '/api/v1/guest-auth/login',
        '/api/v1/guest-auth/password-reset/confirm',
        '/api/v1/guest-auth/password-reset/request',
        '/api/v1/guest-auth/refresh',
        '/api/v1/guest-auth/register',
        '/api/v1/system/health',
        '/api/v1/users',
        '/api/v1/users/{userId}/access',
        '/api/v1/users/{userId}/pin',
      ].sort(),
    );
  });

  it('mọi mã E_* xuất hiện trong tài liệu đều thuộc danh mục §4.2', () => {
    const tokens = serializeDocument().match(/E_[A-Z]+_[A-Z_]+/g) ?? [];
    expect(tokens.length).toBeGreaterThanOrEqual(10);
    for (const token of new Set(tokens)) expect(isErrorCode(token), `mã lạ: ${token}`).toBe(true);
  });

  it('mọi lệnh ghi yêu cầu Idempotency-Key và mọi lệnh gửi được mã tương quan', () => {
    for (const [method, path] of WRITE_TARGETS) {
      const operation = operationAt(method, path);
      const label = `${method.toUpperCase()} ${path}`;
      expect(hasParameterNamed(operation, 'Idempotency-Key'), label).toBe(true);
      expect(hasParameterNamed(operation, 'X-Correlation-Id'), label).toBe(true);
    }
  });

  it('phản hồi lỗi của login trỏ đúng mã trong danh mục', () => {
    const login = document.paths?.['/api/v1/auth/login']?.post;
    expect(login?.responses?.['401']).toMatchObject({
      description: 'E_AUTH_INVALID_CREDENTIALS, E_AUTH_ACCOUNT_LOCKED',
    });
    expect(login?.responses?.['429']).toMatchObject({ description: 'E_GEN_RATE_LIMITED' });
    expect(login?.responses?.['400']).toMatchObject({ description: 'E_GEN_VALIDATION_FAILED' });
  });

  it('chỉ một nơi chứa tiền tố /api/v1 nên URL ghép không bị lặp (F0-01)', () => {
    const servers = document.servers ?? [];
    expect(servers).toHaveLength(1);
    const serverUrl = servers[0]?.url ?? '';
    expect(serverUrl).not.toContain('/api/v1');
    for (const path of Object.keys(document.paths ?? {})) {
      expect(path.startsWith('/api/v1/'), `path thiếu tiền tố: ${path}`).toBe(true);
      const effective = `${serverUrl.replace(/\/$/, '')}${path}`;
      expect(effective.match(/\/api\/v1/g) ?? [], `lặp tiền tố: ${effective}`).toHaveLength(1);
    }
  });

  it('endpoint công khai không khai security, endpoint cần token có bearerAuth (F0-01)', () => {
    for (const [method, path, expectation] of AUTH_OPERATIONS) {
      const label = `${method.toUpperCase()} ${path}`;
      const security = securityOf(operationAt(method, path));
      if (expectation === 'public') expect(security, label).toBeUndefined();
      else expect(security, label).toContain('bearerAuth');
    }
  });

  it('sinh tất định: hai lần sinh cho ra chuỗi giống nhau', () => {
    expect(serializeDocument()).toBe(serializeDocument());
  });

  it('có component ErrorBody dùng chung', () => {
    expect(Object.keys(document.components?.schemas ?? {})).toContain('ErrorBody');
  });
});
