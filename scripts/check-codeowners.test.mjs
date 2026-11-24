/**
 * CODEOWNERS validator, and the repository's own CODEOWNERS. Run with: node --test scripts/
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  checkCodeowners,
  CODEOWNERS_PATH,
  parseCodeowners,
  patternToRegExp,
} from './check-codeowners.mjs';

const FILES = [
  '.github/CODEOWNERS',
  '.github/workflows/ci.yml',
  '.github/workflows/nested/x.yml',
  'scripts/a.mjs',
  'scripts/bootstrap-tenant.mjs',
  'apps/api/Dockerfile',
];

describe('patternToRegExp', () => {
  it('anchors at the root and keeps "*" inside one segment', () => {
    const regexp = patternToRegExp('/scripts/bootstrap-*.mjs');
    assert.ok(regexp.test('scripts/bootstrap-tenant.mjs'));
    assert.ok(!regexp.test('nested/scripts/bootstrap-tenant.mjs'));
    assert.ok(!regexp.test('scripts/x/bootstrap-tenant.mjs'));
  });
  it('treats a trailing "/" as the whole directory, nested files included', () => {
    const regexp = patternToRegExp('/.github/workflows/');
    assert.ok(regexp.test('.github/workflows/ci.yml'));
    assert.ok(regexp.test('.github/workflows/nested/x.yml'));
    assert.ok(!regexp.test('.github/workflows'));
  });
  it('escapes dots', () => {
    assert.ok(!patternToRegExp('/a.mjs').test('aXmjs'));
  });
  it('refuses unanchored, root-wide and unsupported patterns', () => {
    assert.throws(() => patternToRegExp('scripts/a.mjs'), /not anchored/);
    assert.throws(() => patternToRegExp('/'), /whole repository/);
    assert.throws(() => patternToRegExp('/a?.mjs'), /does not support/);
  });
});

describe('checkCodeowners', () => {
  it('accepts a file whose rules all match and cover the required files', () => {
    const text = '# c\n/.github/ @o\n/scripts/a.mjs @o @org/team\n';
    assert.deepEqual(
      checkCodeowners(text, FILES, ['.github/workflows/ci.yml', 'scripts/a.mjs']),
      [],
    );
  });
  it('reports a pattern that matches nothing (a rename silently dropping a gate)', () => {
    const findings = checkCodeowners('/scripts/renamed.mjs @o\n', FILES, []);
    assert.match(findings.join('\n'), /matches no tracked file/);
  });
  it('reports a required file without an owner, using the last matching rule', () => {
    const text = '/scripts/ @o\n/scripts/a.mjs\n';
    const findings = checkCodeowners(text, FILES, ['scripts/a.mjs']);
    assert.match(findings.join('\n'), /names no owner/);
    assert.match(findings.join('\n'), /required file scripts\/a\.mjs has no code owner/);
  });
  it('reports a required file that is no longer tracked', () => {
    assert.match(
      checkCodeowners('/scripts/ @o\n', FILES, ['scripts/gone.mjs']).join('\n'),
      /not tracked/,
    );
  });
  it('reports a malformed owner', () => {
    assert.match(checkCodeowners('/scripts/a.mjs tam\n', FILES, []).join('\n'), /not an @user/);
  });
  it('skips comments and blank lines', () => {
    assert.deepEqual(parseCodeowners('\n# x\n  \n/a @o\n'), [
      { line: 4, pattern: '/a', owners: ['@o'] },
    ]);
  });
});

describe('repository CODEOWNERS', () => {
  it('is valid and owns every required gate file', () => {
    const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
    assert.deepEqual(checkCodeowners(readFileSync(CODEOWNERS_PATH, 'utf8'), tracked), []);
  });
});
