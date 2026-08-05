/**
 * Munaxa Work — Engineering Standards, expressed as lint rules.
 *
 * This layer encodes docs/ENGINEERING_STANDARDS.md. It is intentionally a plain flat-config
 * array with no imports: it is composed *after* a config that registers `@typescript-eslint`
 * (`@munaxa/config-eslint`'s `base` or `root`), and flat config resolves rule namespaces from
 * the merged plugin map, so the rules below bind to the plugin that layer already registered.
 *
 * Every app and package config must spread this after its Munaxa base config:
 *
 *   import base from '@munaxa/config-eslint/base.js';
 *   import standards from '../../tooling/eslint/standards.mjs';
 *   export default [...base, ...standards];
 *
 * @type {import('eslint').Linter.Config[]}
 */

/** Layers, in dependency order. A layer may only import from layers above it. */
const DOMAIN = '**/domain/**/*.{ts,tsx}';
const APPLICATION = '**/application/**/*.{ts,tsx}';
const INFRASTRUCTURE = '**/infrastructure/**/*.{ts,tsx}';
const API = '**/{api,presentation}/**/*.{ts,tsx}';

/** Anything that would drag a framework, a transport or persistence into a pure layer. */
const FRAMEWORKS = [
  '@nestjs/*',
  '@prisma/*',
  'express',
  'fastify',
  'next',
  'next/*',
  'react',
  'react-dom',
  'prisma',
  '@munaxa/ui',
  '@munaxa/ui/*',
];

const HTTP_CLIENTS = [
  'axios',
  'node-fetch',
  'undici',
  'got',
  'http',
  'https',
  'node:http',
  'node:https',
];

/** A second design system is the failure this architecture exists to prevent. */
const COMPETING_UI = [
  '@mui/*',
  'antd',
  '@chakra-ui/*',
  'bootstrap',
  'react-bootstrap',
  'styled-components',
  '@emotion/*',
  '@radix-ui/*',
];

const restrictImports = (patterns, message) => [
  'error',
  { patterns: patterns.map((group) => ({ group: [group], message })) },
];

const TEST_FILES = ['**/*.{test,spec}.{ts,tsx}', '**/tests/**', '**/__tests__/**', '**/testing/**'];

export default [
  {
    name: 'munaxa-work/standards/general',
    files: ['**/*.{ts,tsx}'],
    linterOptions: {
      // "Disable lint rules" is forbidden, so inline directives are inert rather than trusted.
      // scripts/check-standards.mjs reports any that are committed, so they fail loudly.
      noInlineConfig: true,
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      // Complexity
      complexity: ['error', 10],
      'max-depth': ['error', 3],
      'max-params': ['error', 5],
      'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
      'max-nested-callbacks': ['error', 3],

      // Language
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-check': false,
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 20,
        },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-param-reassign': ['error', { props: true }],

      // Git standards: nothing unfinished reaches main.
      'no-warning-comments': [
        'error',
        { terms: ['todo', 'fixme', 'hack', 'xxx'], location: 'anywhere' },
      ],
      'no-debugger': 'error',

      // Logging: structured logger only.
      'no-console': 'error',

      // Naming
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'default', format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'variable', format: ['camelCase', 'UPPER_CASE'], leadingUnderscore: 'allow' },
        {
          // Const arrow components and factories are legitimately PascalCase.
          selector: 'variable',
          modifiers: ['const'],
          format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
          leadingUnderscore: 'allow',
        },
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'function', format: ['camelCase', 'PascalCase'] },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE'] },
        {
          selector: 'classProperty',
          modifiers: ['static', 'readonly'],
          format: ['UPPER_CASE', 'camelCase'],
        },
        // Wire formats (API payloads, database rows, headers) are not ours to rename.
        { selector: ['objectLiteralProperty', 'typeProperty'], format: null },
      ],
    },
  },

  // File budgets. A file at its limit is a file that should already have been split.
  {
    name: 'munaxa-work/standards/file-budgets',
    files: ['**/*.controller.ts'],
    rules: { 'max-lines': ['error', { max: 150, skipBlankLines: true, skipComments: true }] },
  },
  {
    name: 'munaxa-work/standards/file-budgets/service',
    files: ['**/*.service.ts', '**/*.use-case.ts'],
    rules: { 'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }] },
  },
  {
    name: 'munaxa-work/standards/file-budgets/repository',
    files: ['**/*.repository.ts'],
    rules: { 'max-lines': ['error', { max: 250, skipBlankLines: true, skipComments: true }] },
  },

  // Dependency direction: domain ← application ← infrastructure ← api ← presentation.
  {
    name: 'munaxa-work/standards/layers/domain',
    files: [DOMAIN],
    rules: {
      'no-restricted-imports': restrictImports(
        [
          '**/application/**',
          '**/infrastructure/**',
          '**/api/**',
          '**/presentation/**',
          ...FRAMEWORKS,
        ],
        'Domain contains business rules only. It may not depend on any outer layer, framework, ORM or transport.',
      ),
    },
  },
  {
    name: 'munaxa-work/standards/layers/application',
    files: [APPLICATION],
    rules: {
      'no-restricted-imports': restrictImports(
        ['**/infrastructure/**', '**/api/**', '**/presentation/**', ...FRAMEWORKS],
        'Application contains use cases. It depends on domain and on ports — never on infrastructure or transport.',
      ),
    },
  },
  {
    name: 'munaxa-work/standards/layers/infrastructure',
    files: [INFRASTRUCTURE],
    rules: {
      'no-restricted-imports': restrictImports(
        ['**/api/**', '**/presentation/**'],
        'Infrastructure implements ports. It may not depend on transport or UI.',
      ),
    },
  },
  {
    name: 'munaxa-work/standards/layers/api',
    files: [API],
    rules: {
      'no-restricted-imports': restrictImports(
        ['**/presentation/**'],
        'API is transport. It may not depend on the presentation layer.',
      ),
    },
  },

  // Repositories: persistence only. No business rules, no external services.
  {
    name: 'munaxa-work/standards/repositories',
    files: ['**/*.repository.ts'],
    rules: {
      'no-restricted-imports': restrictImports(
        HTTP_CLIENTS,
        'Repositories never call external services. Put the call behind an infrastructure adapter and inject it.',
      ),
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Repositories never call external services.' },
      ],
      complexity: ['error', 5],
    },
  },

  // Presentation: Platform UI only.
  {
    name: 'munaxa-work/standards/ui',
    files: ['**/apps/**/*.{ts,tsx}', '**/presentation/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrictImports(
        COMPETING_UI,
        'Use Platform UI only (@munaxa/ui). A second design system duplicates Platform and is forbidden.',
      ),
    },
  },

  // Tests are exempt from size and console limits; correctness rules still apply.
  {
    name: 'munaxa-work/standards/tests',
    files: TEST_FILES,
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      'max-nested-callbacks': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // Local tooling is not production code.
  {
    name: 'munaxa-work/standards/tooling',
    files: ['scripts/**/*.{ts,mjs,js}', 'tooling/**/*.{ts,mjs,js}', '**/*.config.{ts,mjs,js}'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
];
