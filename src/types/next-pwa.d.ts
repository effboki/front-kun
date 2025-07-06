// Minimal type declaration for the `next-pwa` plugin
// (removes the “could not find a declaration file” TS error)
declare module 'next-pwa' {
  import type { NextConfig } from 'next';

  /** Wrap a Next.js config object to enable PWA support */
  export default function withPWA(
    config?: Partial<NextConfig>
  ): NextConfig;
}