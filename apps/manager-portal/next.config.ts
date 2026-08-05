import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // The design system ships as source-inclusive packages; transpiling them here keeps a single
  // React copy and lets Tailwind see their classes.
  transpilePackages: ['@munaxa/ui', '@munaxa/theme'],
  poweredByHeader: false,
};

export default config;
