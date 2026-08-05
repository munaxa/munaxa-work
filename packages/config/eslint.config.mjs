import base from '@munaxa/config-eslint/base.js';

import standards from '../../tooling/eslint/standards.mjs';

/**
 * This package is the one place in Munaxa Work permitted to read the environment
 * (docs/MASTER_INSTRUCTIONS.md, ADR-0018): it validates `process.env` once and exposes a typed,
 * frozen value. The exemption is declared here, in the owning package, rather than as an inline
 * suppression — it is visible in review and it applies to nothing else.
 *
 * `turbo lint` runs ESLint with each package as its own working directory, so a path glob in the
 * shared standards layer cannot single this package out; only the package itself can.
 *
 * @type {import('eslint').Linter.Config[]}
 */
export default [
  ...base,
  ...standards,
  {
    name: 'work/config/environment-access',
    files: ['src/environment.ts', 'src/environment.test.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
];
