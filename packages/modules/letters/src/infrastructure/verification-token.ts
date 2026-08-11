import { randomBytes } from 'node:crypto';

import type { VerificationTokenPort } from '../application/letters-ports.js';

/**
 * The unguessable half of a letter's identity.
 *
 * Thirty-two bytes from the operating system's cryptographic source, hex-encoded to sixty-four
 * characters — the width the column and the domain's minimum both expect.
 *
 * `Math.random` would be catastrophic here and is worth saying out loud: the verification endpoint
 * takes the token and nothing else, so a predictable one turns a third-party authenticity check
 * into a public register of who works where. The reference number is deliberately *not* used for
 * this — it is printed on the letter and sequential, which makes it guessable by construction
 * (D-20).
 *
 * In infrastructure rather than application because it reaches an operating-system source, which is
 * exactly the kind of thing the application layer is not permitted to know about.
 */
export const randomVerificationToken: VerificationTokenPort = {
  issue: () => randomBytes(32).toString('hex'),
};
