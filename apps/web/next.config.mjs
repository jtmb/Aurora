/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@aurora/auth-service',
    '@aurora/api-gateway',
  ],
  serverExternalPackages: ['better-sqlite3', 'node-pty', 'ws'],
  experimental: {
    externalDir: true,
  },
  env: {},
};

export default nextConfig;
