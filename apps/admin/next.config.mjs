// Plain JavaScript with a JSDoc type, not `next.config.ts`.
//
// Next reads its config at *runtime*, not only at build, and it compiles a TypeScript config with
// the TypeScript compiler — which a production install has quite rightly removed. The result is a
// browser-facing service that starts, fails to load its own config, and exits, with an error
// suggesting you `yarn add typescript`. Shipping a compiler into the runtime image to satisfy a
// config file is the wrong way round; the type annotation below gives the same editor checking
// without the dependency.

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // The design system ships as source-inclusive packages; transpiling them here keeps a single
  // React copy and lets Tailwind see their classes.
  transpilePackages: ['@munaxa/ui', '@munaxa/theme'],
  poweredByHeader: false,
};

export default config;
