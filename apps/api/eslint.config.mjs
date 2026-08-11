import nest from '@munaxa/config-eslint/nest.js';

import standards from '../../tooling/eslint/standards.mjs';

/**
 * The API app. One narrow exemption: an integration fixture or a cross-module test harness chooses
 * which database to connect to, which is a harness concern rather than application configuration —
 * the rule confining `process.env` to `@work/config` exists to stop *business* code branching on
 * the environment, and no business code lives in a `.fixture.ts` or a `-harness.ts`. The same
 * exemption, for the same reason, is in `packages/modules/payroll`.
 *
 * @type {import('eslint').Linter.Config[]}
 */
export default [
  ...nest,
  ...standards,
  {
    name: 'work/api/database-selection',
    files: ['src/**/*.fixture.ts', 'src/**/*-harness.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
];
