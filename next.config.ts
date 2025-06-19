import type { NextConfig } from 'next';

// Next.js configuration
const nextConfig: NextConfig = {
  // Skip ESLint errors during `next build` so production
  // builds don’t fail. You will still see warnings locally.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;