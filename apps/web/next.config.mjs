/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@aurora/auth-service',
    '@aurora/api-gateway',
    '@fortune-sheet/react',
  ],
  serverExternalPackages: [
    'better-sqlite3',
    'node-pty',
    'ws',
    'jsonwebtoken',
    'simple-git',
    'debug',
    '@kwsites/file-exists',
  ],
  experimental: {
    externalDir: true,
  },
  env: {},
};

export default nextConfig;
