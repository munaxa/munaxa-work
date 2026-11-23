/**
 * The db:reset guard's decisions (MW-008). Run with: node --test scripts/
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { judgeReset, OPT_IN } from './db-reset-guard.mjs';

const LOCAL = 'postgresql://work:work@localhost:5432/work';

describe('judgeReset', () => {
  it('allows a local database with the opt-in', () => {
    for (const url of [
      LOCAL,
      'postgres://work:work@127.0.0.1/work',
      'postgresql://work:work@[::1]:5433/work',
    ]) {
      const verdict = judgeReset({ DATABASE_URL: url, [OPT_IN]: '1' });
      assert.equal(verdict.allowed, true, url);
    }
  });

  it('refuses without the opt-in', () => {
    for (const value of [undefined, '', '0', 'true', 'yes']) {
      const verdict = judgeReset({ DATABASE_URL: LOCAL, [OPT_IN]: value });
      assert.equal(verdict.allowed, false);
      assert.match(verdict.reason, new RegExp(OPT_IN));
    }
  });

  it('refuses a remote host even with the opt-in', () => {
    for (const url of [
      'postgresql://work:work@work-testing.cluster-abc.eu-central-1.rds.amazonaws.com:5432/work',
      'postgresql://work:work@10.0.0.5:5432/work',
      'postgresql://work:work@localhost.example.com:5432/work',
      'postgresql://work:work@db:5432/work',
    ]) {
      const verdict = judgeReset({ DATABASE_URL: url, [OPT_IN]: '1' });
      assert.equal(verdict.allowed, false, url);
    }
  });

  it('refuses a local URL whose host= or hostaddr= parameter redirects the connection', () => {
    for (const query of [
      'host=db.example.com',
      'HOST=db.example.com',
      'Host=/var/run/postgresql',
      'hostaddr=10.0.0.5',
      'HostAddr=10.0.0.5',
      'sslmode=disable&hOsT=db.example.com',
      'h%6Fst=db.example.com',
    ]) {
      const verdict = judgeReset({ DATABASE_URL: `${LOCAL}?${query}`, [OPT_IN]: '1' });
      assert.equal(verdict.allowed, false, query);
    }
  });

  it('allows unrelated query parameters', () => {
    const verdict = judgeReset({
      DATABASE_URL: `${LOCAL}?sslmode=disable&schema=public`,
      [OPT_IN]: '1',
    });
    assert.equal(verdict.allowed, true);
  });

  it('refuses a missing, malformed or non-PostgreSQL URL', () => {
    assert.equal(judgeReset({ [OPT_IN]: '1' }).allowed, false);
    assert.equal(judgeReset({ DATABASE_URL: 'not a url', [OPT_IN]: '1' }).allowed, false);
    assert.equal(
      judgeReset({ DATABASE_URL: 'mysql://localhost/work', [OPT_IN]: '1' }).allowed,
      false,
    );
  });
});
