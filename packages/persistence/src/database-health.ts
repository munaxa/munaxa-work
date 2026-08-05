import type { Pool } from 'pg';

/**
 * The database's contribution to readiness and health.
 *
 * It answers with a round trip rather than with the pool's opinion of itself: a pool reports
 * healthy while every connection in it is dead, because it has not tried one. The round trip is
 * a single `select 1` and it is the only answer worth reporting to an orchestrator that will
 * route traffic based on it.
 */

export interface DatabaseHealth {
  readonly status: 'up' | 'down';
  readonly latencyMilliseconds?: number;
  readonly detail?: string;
}

const TIMEOUT_MILLISECONDS = 2000;

export const checkDatabase = async (
  pool: Pool,
  now: () => number = Date.now,
): Promise<DatabaseHealth> => {
  const started = now();

  try {
    await Promise.race([
      pool.query('select 1'),
      new Promise((_resolve, reject) =>
        setTimeout(() => {
          reject(new Error('timed out'));
        }, TIMEOUT_MILLISECONDS),
      ),
    ]);
    return { status: 'up', latencyMilliseconds: now() - started };
  } catch (error) {
    // The reason stays internal — a health endpoint is unauthenticated, and a connection string
    // in an error message is a credential in a public response.
    return {
      status: 'down',
      detail: error instanceof Error && error.message === 'timed out' ? 'timed out' : 'unavailable',
    };
  }
};
