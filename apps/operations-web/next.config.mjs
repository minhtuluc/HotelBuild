/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Gói workspace dùng mã TypeScript nguồn; Next biên dịch tại chỗ (kiến trúc §5).
  transpilePackages: ['@pinehill/contracts', '@pinehill/api-client', '@pinehill/ui-web'],
  eslint: { ignoreDuringBuilds: true },
  // Gói workspace dùng specifier `.js` theo NodeNext; webpack phải ánh xạ sang nguồn TS.
  webpack: (config) => {
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
};

export default nextConfig;
