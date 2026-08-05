import base from '@munaxa/config-eslint/base.js';

import standards from '../../tooling/eslint/standards.mjs';

/**
 * Test infrastructure. Integration tests choose which database to connect to, which is a harness
 * concern rather than application configuration — the rule that confines `process.env` to
 * `@work/config` exists to stop *business* code branching on the environment, and no business
 * code lives here. Declared in this package so the exemption is visible and bounded.
 *
 * @type {import('eslint').Linter.Config[]}
 */
export default [
  ...base,
  ...standards,
  {
    name: 'work/testing/database-selection',
    files: ['src/**/*.integration.test.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
];
