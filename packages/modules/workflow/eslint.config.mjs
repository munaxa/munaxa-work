import base from '@munaxa/config-eslint/base.js';

import standards from '../../../tooling/eslint/standards.mjs';

/**
 * Enterprise Workflow & Approvals.
 *
 * The integration suites and the fixture they share choose which database to connect to, which is a
 * harness concern rather than application configuration — the rule confining `process.env` to
 * `@work/config` exists to stop *business* code branching on the environment, and no business code
 * lives in either. The same exemption Career, Learning and Performance carry, for the same reason.
 *
 * @type {import('eslint').Linter.Config[]}
 */
export default [
  ...base,
  ...standards,
  {
    name: 'work/workflow/database-selection',
    files: ['src/**/*.integration.test.ts', 'src/**/*.fixture.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
];
