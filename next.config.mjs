/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: [
    '192.168.1.33',
  ],
  turbopack: {
    root: process.cwd(),
  },
  // Uploaded files are runtime data, not server dependencies. Without this
  // exclusion, output tracing treats every file in public/uploads as a possible
  // dependency of the dynamic upload/read/delete API routes.
  outputFileTracingExcludes: {
    '/*': ['./public/uploads/**/*'],
  },
};

export default nextConfig;
