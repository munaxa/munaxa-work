#!/usr/bin/env node
/**
 * Loads the synthetic Testing dataset into one Work tenant through the Work API (MW-004).
 * See tooling/testing-data/README.md. Node built-ins only.
 *
 *   node tooling/testing-data/load-synthetic.mjs [--dry-run] [--employees 30] [--period 2026-12]
 *     [--target-confirm=<host>] [--skip-attendance-policy]
 *
 * Idempotent: every record is looked up by a deterministic key before it is created, so a second
 * run against the same tenant creates nothing. `--dry-run` makes only GET requests and prints what
 * a real run would create. Prints codes and counts; never a token, a password or a person's name.
 *
 * Only localhost or a host under `.test.munaxa.com` is a target without `--target-confirm`;
 * production is refused outright (target-guard.mjs).
 *
 * Exit code: 0 on success, 1 when a request failed, 2 when the inputs are incomplete or the target
 * is refused.
 */

import { readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  attendanceSteps,
  compensationSteps,
  leaveSteps,
  money,
  organizationSteps,
  payrollSteps,
  V1,
} from './load-steps.mjs';
import {
  DEFAULT_EMPLOYEES,
  EFFECTIVE_FROM,
  ENTITLEMENT_MINUTES,
  employees,
  payrollPeriod,
} from './synthetic-dataset.mjs';
import { ConfigurationError, accessToken, passwordOf } from './credentials.mjs';
import { TargetRefusedError, guardTargets } from './target-guard.mjs';
import { ApiError, createWorkClient, sanitize } from './work-client.mjs';

export { ConfigurationError, accessToken, passwordOf };

const DEFAULT_PERIOD = '2026-12';

export const parseArguments = (argv) => {
  const options = {
    dryRun: false,
    employees: DEFAULT_EMPLOYEES,
    period: DEFAULT_PERIOD,
    targetConfirm: undefined,
    skipAttendancePolicy: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--skip-attendance-policy') options.skipAttendancePolicy = true;
    else if (argument.startsWith('--target-confirm=')) {
      options.targetConfirm = argument.slice('--target-confirm='.length);
      if (options.targetConfirm === '')
        throw new ConfigurationError('--target-confirm needs a host.');
    } else if (argument === '--employees') options.employees = Number(argv[(index += 1)]);
    else if (argument === '--period') options.period = argv[(index += 1)];
    else throw new ConfigurationError(`Unknown argument ${argument}.`);
  }
  employees(options.employees);
  payrollPeriod(options.period);
  return options;
};

export const loadConfig = (env, argv) => {
  const options = parseArguments(argv);
  const missing = [];
  if (!env.WORK_BASE_URL) missing.push('WORK_BASE_URL');
  const hasLogin = env.LOADER_IDENTIFIER && (env.LOADER_PASSWORD || env.LOADER_PASSWORD_FILE);
  if (!env.LOADER_TOKEN_FILE && !hasLogin) {
    missing.push(
      'LOADER_TOKEN_FILE, or LOADER_IDENTIFIER and LOADER_PASSWORD or LOADER_PASSWORD_FILE',
    );
  }
  if (missing.length > 0) throw new ConfigurationError(`Missing inputs: ${missing.join('; ')}.`);
  const work = env.WORK_BASE_URL.replace(/\/+$/, '');
  const identity = (env.IDENTITY_BASE_URL || work).replace(/\/+$/, '');
  const api = (env.WORK_API_BASE_URL || work).replace(/\/+$/, '');
  // Every host that receives the credential or a write is checked, not only WORK_BASE_URL.
  guardTargets([work, api, identity], options.targetConfirm);
  return {
    ...options,
    api,
    identity,
    identityOrigin: env.IDENTITY_ORIGIN || new URL(identity).origin,
    organisation: env.IDENTITY_ORGANISATION || undefined,
    tenantId: env.WORK_TENANT_ID || undefined,
    tokenFile: env.LOADER_TOKEN_FILE || undefined,
    identifier: env.LOADER_IDENTIFIER || undefined,
    password: env.LOADER_PASSWORD || undefined,
    passwordFile: env.LOADER_PASSWORD_FILE || undefined,
    allowSharedPasswordFile: env.LOADER_ALLOW_SHARED_PASSWORD_FILE === '1',
  };
};

/** A stand-in for a record a dry run would create: every `…Id` reads as "planned". */
const plannedRecord = () =>
  new Proxy(
    { status: 'draft', planned: true },
    {
      get: (target, key) =>
        key in target
          ? target[key]
          : typeof key === 'string' && /id$/i.test(key)
            ? 'planned'
            : undefined,
    },
  );

/**
 * Organization views name their key `id`; a create acknowledgement names it `<thing>Id`. A record
 * known only from its acknowledgement is given `id` too, so a step can use either.
 */
const withId = (record) => {
  if (record.id !== undefined || typeof record !== 'object') return record;
  const key = Object.keys(record).find((name) => /Id$/.test(name));
  return key === undefined ? record : { ...record, id: record[key] };
};

/** Every person, employment and per-employment record, after the shared configuration. */
const employeeSteps = async (context, shared, roster) => {
  const { api, ensure, isPlanned } = context;
  for (const employee of roster) {
    const tag = employee.personNumber;
    const person = await ensure(`person ${tag}`, {
      find: async () =>
        (await api.list(`${V1}/people`, { term: employee.personNumber })).find(
          (one) => one.personNumber === employee.personNumber,
        ),
      create: () =>
        api.post(`${V1}/people`, {
          personNumber: employee.personNumber,
          legalName: employee.legalName,
          dateOfBirth: employee.dateOfBirth,
          effectiveFrom: EFFECTIVE_FROM,
        }),
    });
    const personId = person.record.personId;
    await ensure(`work e-mail of ${tag}`, {
      find: async () =>
        isPlanned(person)
          ? undefined
          : ((await api.get(`${V1}/people/${personId}/profile`))?.contacts ?? []).find(
              (contact) => contact.value === employee.email,
            ),
      create: () =>
        api.post(`${V1}/people/${personId}/contacts`, {
          channel: 'email',
          purpose: 'work',
          value: employee.email,
          isPrimary: true,
          effectiveFrom: EFFECTIVE_FROM,
        }),
    });
    const employment = await ensure(`employment ${employee.externalEmployeeNumber}`, {
      find: async () =>
        isPlanned(person) ? undefined : (await api.list(`${V1}/employments`, { personId }))[0],
      create: () =>
        api.post(`${V1}/employments`, {
          personId,
          externalEmployeeNumber: employee.externalEmployeeNumber,
          employmentTypeCode: employee.employmentTypeCode,
          startDate: employee.startDate,
        }),
    });
    const employmentId = employment.record.employmentId;
    await ensure(`assignment of ${employee.externalEmployeeNumber}`, {
      find: async () =>
        isPlanned(employment)
          ? undefined
          : (await api.list(`${V1}/employments/${employmentId}/assignments`))[0],
      create: () =>
        api.post(`${V1}/employments/${employmentId}/assignments`, {
          unitId: shared.departments[employee.departmentCode].record.id,
          positionId: shared.positions[employee.positionCode].record.id,
          assignmentType: 'primary',
          fte: 1,
          effectiveFrom: employee.startDate,
        }),
    });
    await ensure(`leave entitlement of ${employee.externalEmployeeNumber}`, {
      find: async () =>
        isPlanned(employment) || isPlanned(shared.leaveType)
          ? undefined
          : (
              await api.list(`${V1}/leave/entitlements`, {
                employmentId,
                leaveTypeId: shared.leaveType.record.leaveTypeId,
              })
            )[0],
      create: () =>
        api.post(`${V1}/leave/entitlements`, {
          employmentId,
          leaveTypeId: shared.leaveType.record.leaveTypeId,
          onDate: EFFECTIVE_FROM,
          grantedMinutes: ENTITLEMENT_MINUTES,
          source: 'opening',
        }),
    });
    // Attendance lists no assignments; an existing one is refused as an overlap (409).
    await ensure(`schedule assignment of ${employee.externalEmployeeNumber}`, {
      find: async () => undefined,
      create: () =>
        api.post(`${V1}/attendance/schedules/${shared.schedule.record.scheduleId}/assignments`, {
          employmentId,
          effectiveFrom: employee.startDate,
        }),
      conflictMeansExists: true,
    });
    await ensure(`base salary of ${employee.externalEmployeeNumber}`, {
      find: async () =>
        isPlanned(employment) || isPlanned(shared.component)
          ? undefined
          : (
              await api.list(`${V1}/compensation/recurring`, {
                employmentId,
                componentId: shared.component.record.componentId,
              })
            )[0],
      create: () =>
        api.post(`${V1}/compensation/recurring`, {
          employmentId,
          componentId: shared.component.record.componentId,
          amount: money(employee.baseSalaryMinor),
          effectiveFrom: employee.startDate,
        }),
    });
  }
};

/**
 * Runs the load. `io`: fetch, write (one line), readFile. Returns the counts; throws on the first
 * request that fails, after printing what was done up to then.
 */
export const runLoader = async (config, io) => {
  const token = await accessToken(config, io);
  const client = createWorkClient({
    baseUrl: config.api,
    token,
    tenantId: config.tenantId,
    fetch: io.fetch,
  });
  const writes = [];
  // A dry run's client cannot write: the guard is here, not in each step.
  const api = config.dryRun
    ? {
        ...client,
        post: async (path) => {
          writes.push(path);
          throw new Error(`dry run attempted a write to ${path}`);
        },
        put: async (path) => {
          writes.push(path);
          throw new Error(`dry run attempted a write to ${path}`);
        },
      }
    : client;
  const counts = { created: 0, existing: 0, planned: 0, unverifiable: 0 };
  const verb = config.dryRun ? 'would create' : 'created';

  /**
   * `conflictMeansExists`: a 409 on create counts as already present. With `conflictDetail`, only a
   * 409 whose detail is exactly that reason does; any other 409 fails the run.
   */
  const ensure = async (
    label,
    { find, create, conflictMeansExists = false, conflictDetail = undefined },
  ) => {
    const found = await find();
    if (found !== undefined) {
      counts.existing += 1;
      return { record: found, created: false };
    }
    if (config.dryRun && conflictMeansExists) {
      // Nothing lists these, so a dry run cannot tell; a real run is refused (409) if present.
      counts.unverifiable += 1;
      return { record: {}, created: false };
    }
    if (config.dryRun) {
      counts.planned += 1;
      io.write(`${verb} ${label}`);
      return { record: plannedRecord(), created: true, planned: true };
    }
    try {
      const answer = await create();
      counts.created += 1;
      io.write(`${verb} ${label}`);
      // A create answers with an acknowledgement ({ unitTypeId, code }) rather than the view, so
      // the record is read back the way a later run would find it.
      return { record: withId((await find()) ?? answer ?? {}), created: true };
    } catch (error) {
      const present =
        conflictMeansExists &&
        error instanceof ApiError &&
        error.status === 409 &&
        (conflictDetail === undefined || error.detail === conflictDetail);
      if (present) {
        counts.existing += 1;
        return { record: {}, created: false };
      }
      throw error;
    }
  };
  const context = {
    api,
    ensure,
    isPlanned: (entry) => entry?.planned === true,
    options: { skipAttendancePolicy: config.skipAttendancePolicy },
  };

  const organization = await organizationSteps(context);
  const { leaveType } = await leaveSteps(context);
  const { schedule } = await attendanceSteps(context);
  const { component } = await compensationSteps(context);
  await payrollSteps(context, {
    legalEntity: organization.legalEntity,
    period: payrollPeriod(config.period),
  });
  await employeeSteps(
    context,
    { ...organization, leaveType, schedule, component },
    employees(config.employees),
  );

  io.write(
    config.dryRun
      ? `Dry run: ${counts.planned} to create, ${counts.existing} already present, ` +
          `${counts.unverifiable} not checkable without writing (created or refused as present), no writes.`
      : `Done: ${counts.created} created, ${counts.existing} already present.`,
  );
  return { ...counts, writes };
};

export const main = async (env = process.env, argv = process.argv.slice(2)) => {
  let config;
  try {
    config = loadConfig(env, argv);
  } catch (error) {
    const refused =
      error instanceof ConfigurationError ||
      error instanceof RangeError ||
      error instanceof TargetRefusedError;
    if (!refused) throw error;
    process.stderr.write(`load-synthetic: ${error.message} See tooling/testing-data/README.md.\n`);
    return 2;
  }
  const secrets = [config.password].filter(Boolean);
  const clean = (text) =>
    secrets.reduce((out, secret) => out.split(secret).join('[redacted]'), sanitize(text));
  try {
    await runLoader(config, {
      fetch: globalThis.fetch,
      write: (line) => process.stdout.write(`${clean(line)}\n`),
      readFile: (path) => readFileSync(path, 'utf8'),
      fileMode: (path) => statSync(path).mode,
      secret: (value) => secrets.push(value),
    });
    return 0;
  } catch (error) {
    if (error instanceof ConfigurationError) {
      process.stderr.write(`load-synthetic: ${clean(error.message)}\n`);
      return 2;
    }
    process.stderr.write(
      `load-synthetic: ${clean(error instanceof Error ? error.message : error)}\n`,
    );
    return 1;
  }
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
