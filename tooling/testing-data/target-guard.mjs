/**
 * The loader writes hundreds of records, so it refuses any host that is not plainly Testing or
 * local (MW-004). Allowed without confirmation: localhost, 127.0.0.1, ::1 and any host under
 * `.test.munaxa.com`. Every other Munaxa host (`munaxa.com` and anything under it that is not under
 * `.test.munaxa.com`: work, id, admin, ...) is refused unconditionally, confirmation or not, so the
 * loader's password can never reach production Identity. Any non-Munaxa host needs
 * `--target-confirm=<exact host>`.
 */

export class TargetRefusedError extends Error {}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);
const TESTING_SUFFIX = '.test.munaxa.com';
const MUNAXA = 'munaxa.com';

/** The host name of a URL, lower-cased, without IPv6 brackets or a trailing dot. */
export const hostOf = (url) => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new TargetRefusedError(`${url} is not a URL.`);
  }
  return parsed.hostname
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1')
    .replace(/\.$/, '');
};

/** A Munaxa host outside Testing: production or anything not plainly a test environment. */
export const isProduction = (host) =>
  (host === MUNAXA || host.endsWith(`.${MUNAXA}`)) && !host.endsWith(TESTING_SUFFIX);

export const isTestingOrLocal = (host) => LOOPBACK.has(host) || host.endsWith(TESTING_SUFFIX);

/**
 * Throws unless every URL the loader will call is allowed. `confirmedHost` is the value of
 * `--target-confirm`, which must equal the host exactly.
 */
export const guardTargets = (urls, confirmedHost) => {
  for (const url of urls) {
    const host = hostOf(url);
    if (isProduction(host)) {
      throw new TargetRefusedError(
        `${host} is a Munaxa host outside ${TESTING_SUFFIX} (production); the synthetic ` +
          'loader never runs against it, confirmed or not.',
      );
    }
    if (isTestingOrLocal(host)) continue;
    if (confirmedHost === undefined) {
      throw new TargetRefusedError(
        `${host} is not localhost or under ${TESTING_SUFFIX}; ` +
          `pass --target-confirm=${host} if it really is a test environment.`,
      );
    }
    if (confirmedHost.toLowerCase() !== host) {
      throw new TargetRefusedError(
        `--target-confirm=${confirmedHost} does not match the target host ${host}.`,
      );
    }
  }
};
