import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const rawBackendUrl = process.env.NEXT_PUBLIC_API_URL || process.env.BACKEND_URL || 'http://localhost:8000';
    let target = rawBackendUrl.trim().replace(/\/+$/, '');
    if (target.endsWith('/api')) {
      target = target.slice(0, -4);
    }
    if (!target) {
      target = 'http://localhost:8000';
    }
    return [
      {
        source: '/api/:path*',
        destination: `${target}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
