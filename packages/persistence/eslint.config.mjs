import base from '@munaxa/config-eslint/base.js';

import standards from '../../tooling/eslint/standards.mjs';

/**
 * Shared persistence infrastructure. It is the one place permitted to know a database driver
 * exists; every layer above it depends on the kernel's ports instead.
 *
 * @type {import('eslint').Linter.Config[]}
 */
export default [
  ...base,
  ...standards,
  {
    name: 'work/persistence/database-selection',
    files: ['src/**/*.integration.test.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
];
