import { z } from 'zod';

import { ConfigurationError } from './environment.js';

/**
 * What a portal needs from the environment, and nothing more.
 *
 * A separate schema rather than a subset of `environmentSchema`, because that one requires
 * `DATABASE_URL` — and a presentation application that had to be given a database connection
 * string in order to start would be a presentation application somebody eventually connects to
 * the database. The portals reach the product through the API and nothing else.
 *
 * This exists so that the rule confining `process.env` to this package stays absolute. Without
 * it a portal would need either an exception in the lint layer or a raw environment read, and
 * both are how "configuration is validated in one place" stops being true.
 */
export const portalEnvironmentSchema = z.object({
  /** Where the product's API lives. A URL, validated, so a typo fails at startup. */
  WORK_API_URL: z.string().url().default('http://127.0.0.1:3000'),

  /**
   * Where Platform's sign-in lives.
   *
   * A portal does not authenticate anybody (ADR-0001); it sends them somewhere that does, and
   * Platform's service sets the session cookie this portal then reads. So the whole of Work's
   * sign-in configuration is one URL, and it is deliberately not a client identifier, a secret or
   * a redirect contract — none of which Work is entitled to hold.
   *
   * Optional, because no such service is deployed yet. Unset, the portal says so plainly instead
   * of offering a button that goes nowhere.
   */
  PLATFORM_SIGN_IN_URL: z.string().url().optional(),
});

export type PortalEnvironment = z.infer<typeof portalEnvironmentSchema>;

export const loadPortalEnvironment = (
  source: Record<string, string | undefined>,
): PortalEnvironment => {
  const result = portalEnvironmentSchema.safeParse(source);

  if (!result.success) {
    throw new ConfigurationError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return Object.freeze(result.data);
};

/**
 * Reads and validates the real process environment for a portal.
 *
 * One of the two expressions in Munaxa Work that touch `process.env`; every portal calls this
 * instead of reading it directly, so the lint rule stays absolute rather than carrying an
 * exception.
 */
export const loadPortalProcessEnvironment = (): PortalEnvironment =>
  loadPortalEnvironment(process.env);
