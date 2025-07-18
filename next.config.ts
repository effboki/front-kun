// next.config.ts
import type { NextConfig } from 'next';

/**
 * next-pwa v5.6.0 を CommonJS 形式で利用する。
 * require でオプションを渡し、返ってきた withPWA で Next.js 設定をラップするのが
 * 最もエラーが出にくく、Next.js 公式でも推奨されている書き方です。
 */
const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
  runtimeCaching: [], // 必要に応じてカスタム
  scope: '/',
});

/** Next.js base settings */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  /**
   * Redirect root "/" to "/<storeId>"
   * `NEXT_PUBLIC_STORE_ID` should be set per‑environment (Vercel project or .env.local).
   * Falls back to "demo" when not defined.
   */
  async redirects() {
    const storeId = process.env.NEXT_PUBLIC_STORE_ID || 'demo';
    return [
      {
        source: '/',               // incoming path
        destination: `/${storeId}`, // redirected path
        permanent: false,          // 302 (set true for 308)
      },
    ];
  },
  // 他に必要な Next.js 設定をここに追加
};

module.exports = withPWA(nextConfig);
