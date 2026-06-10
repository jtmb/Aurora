/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@aurora/auth-service',
    '@aurora/api-gateway',
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
  // Rewrite OnlyOffice absolute paths back through our proxy.
  // The Document Server's HTML/JS references resources with absolute
  // paths like /web-apps/... and /sdkjs-plugins/... — the browser
  // resolves these relative to our origin (localhost:3000), so we
  // internally rewrite them to go through /api/onlyoffice/...
  async rewrites() {
    const dsHost = process.env.ONLYOFFICE_DS_URL || 'http://localhost:8082';
    return [
      {
        source: '/web-apps/:path*',
        destination: '/api/onlyoffice/web-apps/:path*',
      },
      {
        source: '/sdkjs-plugins/:path*',
        destination: '/api/onlyoffice/sdkjs-plugins/:path*',
      },
      {
        source: '/fonts/:path*',
        destination: '/api/onlyoffice/fonts/:path*',
      },
      {
        source: '/cache/:path*',
        destination: '/api/onlyoffice/cache/:path*',
      },
      {
        source: '/doc/:path*',
        destination: '/api/onlyoffice/doc/:path*',
      },
    ];
  },
  env: {},
};

export default nextConfig;
