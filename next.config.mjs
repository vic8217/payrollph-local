/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: [
    '192.168.1.33',
  ],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
