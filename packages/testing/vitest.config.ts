import { defineConfig } from 'vitest/config';

/**
 * These suites run one file at a time, and that is a correctness requirement rather than a
 * throughput preference.
 *
 * Three of them provision the roles they test against — `create role`, `grant usage on schema
 * public`, `grant … on all tables` — because the properties under test are properties of a role
 * meeting a policy, and a fake role would prove nothing. Roles are cluster-global and a schema's
 * ACL is a single catalogue row, so two files doing that concurrently against one database are two
 * transactions updating the same tuple. PostgreSQL answers `tuple concurrently updated` and the
 * run fails somewhere in setup, unrelated to anything the test asserts.
 *
 * It surfaced the first time CI could reach these suites at all: locally the files happened not to
 * overlap, and on a cold CI runner they did. A race that depends on scheduling is not something to
 * leave in place because it usually wins.
 *
 * The cost is a few seconds — the slowest file here is under two of them.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
