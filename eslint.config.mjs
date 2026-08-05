import root from '@munaxa/config-eslint/root.js';

import standards from './tooling/eslint/standards.mjs';

/**
 * Root ESLint flat config. A fast, non-type-checked safety net for root-level sweeps.
 * Each app/package defines its own stricter, type-aware config, which takes precedence
 * under `turbo lint` — and must spread the same standards layer. See
 * docs/ENGINEERING_STANDARDS.md.
 */
export default [
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.turbo/**',
      'apps/mobile/**',
      'infra/**',
      '**/*.config.{js,mjs,cjs,ts}',
      '**/*.d.ts',
    ],
  },
  ...root,
  ...standards,
];
