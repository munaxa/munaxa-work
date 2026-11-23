import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/**
 * The shared harness of the `pnpm db:bootstrap` suites: the real script, run as a child process
 * exactly as an operator runs it, with the inputs its guard requires (MW-005).
 */

export const BOOTSTRAP_ISSUER = 'https://identity.bootstrap-test.invalid';

const SCRIPT = fileURLToPath(new URL('../../../scripts/bootstrap-tenant.mjs', import.meta.url));

const run = promisify(execFile);

export interface BootstrapResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

/**
 * One Identity-shaped organisation id (a UUID, as Identity mints them) per person, and every id
 * handed out remembered, so a suite deletes exactly the bindings it created and nothing else.
 */
export class Organisations {
  private readonly byPerson = new Map<string, string>();
  private readonly issued = new Set<string>();

  public of(person: string): string {
    const known = this.byPerson.get(person);
    if (known !== undefined) return known;
    const id = this.fresh();
    this.byPerson.set(person, id);
    return id;
  }

  public fresh(): string {
    const id = randomUUID();
    this.issued.add(id);
    return id;
  }

  public all(): readonly string[] {
    return [...this.issued];
  }
}

/**
 * Completes an operator's arguments the way every test expects unless it is about leaving one out:
 * the person's organisation, its confirmation and the issuer. `--no-organisation`, `--no-confirm`
 * and `--no-issuer` leave the corresponding input out.
 */
export const operatorArguments = (
  args: readonly string[],
  organisations: Organisations,
): readonly string[] => {
  const markers = new Set(['--no-organisation', '--no-confirm', '--no-issuer']);
  const out = args.filter((arg) => !markers.has(arg));
  const given = args.indexOf('--platform-tenant-id');
  const person = args[args.indexOf('--platform-user-id') + 1];
  let organisation = given === -1 ? undefined : args[given + 1];
  if (organisation === undefined && person !== undefined && !args.includes('--no-organisation')) {
    organisation = organisations.of(person);
    out.push('--platform-tenant-id', organisation);
  }
  if (
    organisation !== undefined &&
    !args.includes('--no-confirm') &&
    !args.some((arg) => arg.startsWith('--confirm-organisation'))
  ) {
    out.push(`--confirm-organisation=${organisation}`);
  }
  if (!args.includes('--no-issuer') && !args.some((arg) => /^--(platform-)?issuer/.test(arg))) {
    out.push('--issuer', BOOTSTRAP_ISSUER);
  }
  return out;
};

/**
 * Runs the script with this Node binary and reports both streams and the exit code. The child gets
 * only what the script reads: NODE_ENV=test, the database and PLATFORM_AUTH_ISSUER; `environment`
 * overrides any of them or adds one, and a value of `undefined` removes the variable. Nothing is
 * inherited from the test process, so no stray variable of the runner can change the outcome.
 */
export const runBootstrap = async (
  args: readonly string[],
  databaseUrl: string,
  environment: Readonly<Record<string, string | undefined>> = {},
): Promise<BootstrapResult> => {
  const merged: Readonly<Record<string, string | undefined>> = {
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    PLATFORM_AUTH_ISSUER: BOOTSTRAP_ISSUER,
    ...environment,
  };
  const env = Object.fromEntries(
    Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  try {
    const { stdout, stderr } = await run(process.execPath, [SCRIPT, ...args], { env });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
      code: failure.code ?? 1,
    };
  }
};
