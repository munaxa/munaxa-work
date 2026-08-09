import base from '@munaxa/config-eslint/base.js';

import standards from '../../../tooling/eslint/standards.mjs';

/**
 * Recruitment. The integration suites and the fixture they share choose which database to connect
 * to, which is a harness concern rather than application configuration — the rule confining
 * `process.env` to `@work/config` exists to stop *business* code branching on the environment,
 * and no business code lives in either.
 *
 * @type {import('eslint').Linter.Config[]}
 */
export default [
  ...base,
  ...standards,
  {
    name: 'work/recruitment/database-selection',
    files: ['src/**/*.integration.test.ts', 'src/**/*.fixture.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
];
