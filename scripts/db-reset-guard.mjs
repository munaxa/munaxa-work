#!/usr/bin/env node
/**
 * Guard in front of `pnpm db:reset` — MW-008, prisma/README.md.
 *
 * `prisma migrate reset` drops every table and re-runs the migrations. That is what a developer
 * wants on a laptop and a disaster anywhere else, and one mistyped `DATABASE_URL` is the
 * difference. The reset runs only when both hold:
 *
 * - `DATABASE_URL` is set in the environment (not only in a `.env` file, which this guard cannot
 *   see and Prisma would read) and names this machine: localhost, 127.0.0.1 or ::1, with no
 *   `host=` or `hostaddr=` parameter (any letter case) redirecting the connection elsewhere;
 * - `WORK_ALLOW_DB_RESET=1` is set, so nobody resets by accident or by habit.
 *
 * Usage: WORK_ALLOW_DB_RESET=1 DATABASE_URL=postgresql://work:work@localhost:5432/work pnpm db:reset
 */

import { fileURLToPath } from 'node:url';

export const OPT_IN = 'WORK_ALLOW_DB_RESET';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
/** Connection parameters that override the URL's host, in any letter case. */
const REDIRECTING_PARAMS = new Set(['host', 'hostaddr']);

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{allowed: true, target: string} | {allowed: false, reason: string}}
 */
export function judgeReset(env) {
  const raw = env.DATABASE_URL;
  if (!raw) {
    return {
      allowed: false,
      reason:
        'DATABASE_URL is not set in the environment. Export it explicitly for the local ' +
        'database you mean to wipe; a value only in a .env file is not checked, so it is refused.',
    };
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { allowed: false, reason: 'DATABASE_URL is not a URL.' };
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    return { allowed: false, reason: `DATABASE_URL uses ${url.protocol}, not postgresql:.` };
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    return {
      allowed: false,
      reason: `DATABASE_URL points at "${url.hostname}". Only localhost, 127.0.0.1 or ::1 may be reset.`,
    };
  }
  const redirect = [...url.searchParams.keys()].find((key) =>
    REDIRECTING_PARAMS.has(key.toLowerCase()),
  );
  if (redirect !== undefined) {
    return {
      allowed: false,
      reason: `DATABASE_URL carries a ${redirect}= parameter, which can send the connection elsewhere.`,
    };
  }
  if (env[OPT_IN] !== '1') {
    return {
      allowed: false,
      reason: `${OPT_IN}=1 is not set. Set it to confirm you mean to drop every table.`,
    };
  }
  const port = url.port || '5432';
  return { allowed: true, target: `${url.hostname}:${port}${url.pathname}` };
}

function main() {
  const verdict = judgeReset(process.env);
  if (!verdict.allowed) {
    process.stderr.write(`db:reset refused: ${verdict.reason}\n`);
    process.stderr.write(
      'Never reset, `migrate dev` or `db push` a shared database; see prisma/README.md.\n',
    );
    process.exit(1);
  }
  process.stderr.write(
    `WARNING: db:reset drops every table in ${verdict.target} and re-applies the SQL migrations.\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
