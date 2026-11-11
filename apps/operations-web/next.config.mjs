import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // HB-175 (QĐ-08): chạy trên VPS bằng image `docker/web.Dockerfile` — gói `server.js` tự chứa, chỉ các
  // phụ thuộc được dùng. Gốc truy vết là gốc monorepo để gói workspace (`packages/*`) vào được bản gói.
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  // Gói workspace dùng mã TypeScript nguồn; Next biên dịch tại chỗ (kiến trúc §5).
  transpilePackages: [
    '@pinehill/contracts',
    '@pinehill/api-client',
    '@pinehill/ui-web',
    '@pinehill/web-session',
  ],
  eslint: { ignoreDuringBuilds: true },
  // `next build` chỉ kiểm kiểu mã app; test (có import fixture ngoài app như `tests/e2e/fake-api`) vẫn được
  // typecheck đầy đủ bởi `pnpm typecheck` trong CI. Cần để build image không chép `tests/` (HB-175).
  typescript: { tsconfigPath: 'tsconfig.next.json' },
  // Gói workspace dùng specifier `.js` theo NodeNext; webpack phải ánh xạ sang nguồn TS.
  webpack: (config) => {
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
};

export default nextConfig;
