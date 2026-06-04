/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@aurora/shared',
    '@aurora/auth-service',
    '@aurora/api-gateway',
  ],
  experimental: {
    externalDir: true,
  },
  env: {},
};

export default nextConfig;
