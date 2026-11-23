/**
 * The synthetic loader's credentials: an access token from a file, or from signing in to Identity
 * as a browser would with a password from LOADER_PASSWORD or LOADER_PASSWORD_FILE. Never printed.
 */

export class ConfigurationError extends Error {}

const SESSION_COOKIE = '__Host-mx_session';

/**
 * The password from LOADER_PASSWORD, or from LOADER_PASSWORD_FILE. A file anyone but its owner can
 * read is refused unless LOADER_ALLOW_SHARED_PASSWORD_FILE=1, and then still warned about (the same
 * rule as the smoke script's token files). `io.secret` registers it for redaction.
 */
export const passwordOf = (config, io) => {
  if (config.password !== undefined || config.passwordFile === undefined) return config.password;
  if ((io.fileMode(config.passwordFile) & 0o077) !== 0) {
    if (!config.allowSharedPasswordFile) {
      throw new ConfigurationError(
        'LOADER_PASSWORD_FILE is readable by group or others; chmod 600 it, or set ' +
          'LOADER_ALLOW_SHARED_PASSWORD_FILE=1.',
      );
    }
    io.write('WARN LOADER_PASSWORD_FILE is readable by group or others.');
  }
  const password = io.readFile(config.passwordFile).replace(/\r?\n$/, '');
  if (password === '') throw new ConfigurationError('LOADER_PASSWORD_FILE is empty.');
  io.secret?.(password);
  return password;
};

/** An access token: from the file, or by signing in to Identity as a browser would. */
export const accessToken = async (config, io) => {
  if (config.tokenFile) {
    const token = io.readFile(config.tokenFile).trim();
    if (token === '') throw new ConfigurationError('LOADER_TOKEN_FILE is empty.');
    return token;
  }
  const response = await io.fetch(`${config.identity}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: config.identityOrigin },
    body: JSON.stringify({
      identifier: config.identifier,
      password: passwordOf(config, io),
      ...(config.organisation ? { organisation: config.organisation } : {}),
    }),
    redirect: 'manual',
  });
  const cookie = response.headers
    .getSetCookie()
    .map((header) => header.split(';')[0])
    .find((pair) => pair.startsWith(`${SESSION_COOKIE}=`));
  if (response.status !== 200 || cookie === undefined) {
    throw new Error(`Identity sign-in answered ${response.status}`);
  }
  return decodeURIComponent(cookie.slice(SESSION_COOKIE.length + 1));
};
