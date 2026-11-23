/**
 * Output redaction for the Work smoke test (MW-006).
 *
 * Every line the smoke script writes passes through `redact`. It removes, in this order:
 *   1. every secret the run was given (passwords, tokens read from files, cookie values),
 *   2. anything shaped like a JWT, wherever it appears,
 *   3. the value after `Bearer `, and the value of any `name=value` cookie pair whose name looks
 *      like a session, refresh or token cookie.
 * The first rule is exact and the other two catch a secret the script never knew it had (a token
 * echoed in an error body, for instance). Node built-ins only.
 */

export const REDACTED = '[redacted]';

/** Three base64url segments, the first starting `eyJ` (`{"`): every JWT, and few other things. */
const JWT = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const BEARER = /\b(Bearer)\s+[^\s"',;]+/gi;
const COOKIE_PAIR =
  /\b((?:__Host-|__Secure-)?[A-Za-z0-9_.-]*(?:session|refresh|token|auth|mfa)[A-Za-z0-9_.-]*)=([^;\s"',]+)/gi;

/** Shortest secret worth replacing; shorter strings would mangle ordinary words. */
const MINIMUM_SECRET_LENGTH = 4;

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A redactor bound to the secrets of one run. `add` registers a secret learned later (a token
 * returned by sign-in), so it is redacted from every line written after that point.
 */
export const createRedactor = (initialSecrets = []) => {
  const secrets = new Set();

  const add = (secret) => {
    if (typeof secret !== 'string') return;
    const trimmed = secret.trim();
    if (trimmed.length < MINIMUM_SECRET_LENGTH) return;
    secrets.add(trimmed);
    // The URL-encoded form is what appears inside a Cookie or Set-Cookie header.
    const encoded = encodeURIComponent(trimmed);
    if (encoded !== trimmed) secrets.add(encoded);
  };
  for (const secret of initialSecrets) add(secret);

  const redact = (input) => {
    let text = String(input);
    // Longest first, so a secret that contains another is replaced whole.
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
      text = text.replace(new RegExp(escape(secret), 'g'), REDACTED);
    }
    return text
      .replace(JWT, REDACTED)
      .replace(BEARER, `$1 ${REDACTED}`)
      .replace(COOKIE_PAIR, `$1=${REDACTED}`);
  };

  return { add, redact };
};

/** True when the text still holds something token-shaped. The tests assert this is false. */
export const looksTokenShaped = (text) =>
  new RegExp(JWT.source).test(text) ||
  /\bBearer\s+(?!\[redacted\])\S+/i.test(text) ||
  /mx_(?:session|refresh)=(?!\[redacted\])[^;\s]+/i.test(text);
