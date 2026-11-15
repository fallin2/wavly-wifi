import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Server-only modules (postgres, bcryptjs) must never be bundled for the browser:
  serverExternalPackages: ['postgres', 'bcryptjs', 'otplib'],
};

export default nextConfig;
