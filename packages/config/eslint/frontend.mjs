/**
 * Ràng buộc kiến trúc cho 4 frontend và các gói giao diện.
 * Nguồn: ADR-018 (chỉ gọi /api/v1 qua packages/api-client), kiến trúc §6, QT §11 (process.env chỉ ở apps/star/src/config).
 */

const FORBIDDEN_BACKEND_IMPORTS = [
  { name: '@prisma/client', message: 'Frontend không được chạm CSDL (ADR-018).' },
  { name: 'ioredis', message: 'Frontend không được chạm Redis (ADR-018).' },
  { name: 'bullmq', message: 'Frontend không được chạm hàng đợi (ADR-018).' },
  {
    name: '@pinehill/domain',
    message: 'Miền nghiệp vụ chỉ chạy authoritative ở API/worker (ADR-018).',
  },
  { name: 'zod', message: 'Validate ở biên thuộc packages/contracts, không trong app/UI (QT §2).' },
  {
    name: '@pinehill/contracts/dist',
    message: 'Dùng types từ @pinehill/contracts qua index công khai.',
  },
];

/** Chặn import backend/CSDL/quy tắc nghiệp vụ trong mọi bề mặt giao diện. */
export const frontendRestrictions = [
  {
    files: ['apps/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { paths: FORBIDDEN_BACKEND_IMPORTS }] },
  },
  {
    files: [
      'packages/api-client/**/*.{ts,tsx}',
      'packages/ui-web/**/*.{ts,tsx}',
      'packages/ui-native/**/*.{ts,tsx}',
    ],
    rules: { 'no-restricted-imports': ['error', { paths: FORBIDDEN_BACKEND_IMPORTS }] },
  },
];

/** Secret/env chỉ được đọc ở apps/<app>/src/config (kiến trúc §7.5; QT §11). */
export const environmentRestrictions = [
  {
    files: ['packages/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Cấu hình chỉ đọc ở apps/*/src/config (kiến trúc §7.5).',
        },
      ],
    },
  },
  {
    files: ['apps/*/src/config/**/*.ts', 'apps/*/src/config/**/*.tsx'],
    rules: { 'no-restricted-properties': 'off' },
  },
];
