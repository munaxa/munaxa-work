/**
 * What the synthetic loader creates, in dependency order, each as check-before-create.
 *
 * Every record is found by a deterministic natural key (a code, a person number, an employment's
 * person, an entitlement's employment and leave type) before anything is written, so a second run
 * finds everything and writes nothing. Children of a definition that has no list of its own (shift
 * placements, plan components, tenant-wide policy assignments) are written only in the run that
 * created or found their parent still in draft, and the parent is published last, so a run that
 * stops halfway is completed by the next one rather than duplicated.
 */

import {
  ATTENDANCE_POLICY,
  BUDGETED_HEADCOUNT,
  COMPANY,
  COMPONENT,
  DEDUCTION,
  DEPARTMENTS,
  EFFECTIVE_FROM,
  LEAVE_POLICY,
  LEAVE_TYPE,
  LEGAL_ENTITY,
  PAYROLL_GROUP,
  PLAN,
  POSITIONS,
  SCHEDULE,
  SHIFT,
  SHIFT_SEGMENTS,
  UNIT_TYPES,
  CURRENCY,
} from './synthetic-dataset.mjs';
import { ApiError, itemsOf } from './work-client.mjs';

const V1 = '/api/v1';
const byCode = (code) => (record) => record.code === code;
const isDraft = (record) => record?.status === 'draft';
/** The optimistic-lock version of a record, which a just-created definition holds at 1. */
const versionOf = (record) => (typeof record?.version === 'number' ? record.version : 1);
const money = (amountMinor) => ({
  amountMinor,
  currencyCode: CURRENCY.code,
  currencyExponent: CURRENCY.exponent,
});

const isServerError = (error) => error instanceof ApiError && error.status >= 500;

/** Every unit view in the hierarchy tree, depth first. */
const unitsIn = (nodes) => nodes.flatMap((node) => [node.unit, ...unitsIn(node.children ?? [])]);

/**
 * A unit by code. The units list is the natural lookup; when it fails on the server (the list
 * answers 500 for every query as of 8a975f6, reported with MW-004) the placed units in the
 * hierarchy are searched instead, which is enough because this loader places every unit it
 * creates in the same run.
 */
const findUnit = async (api, code) => {
  try {
    return (await api.list(`${V1}/organization/units`, { term: code })).find(byCode(code));
  } catch (error) {
    if (!isServerError(error)) throw error;
    const tree = await api.get(`${V1}/organization/hierarchy`);
    return unitsIn(tree?.roots ?? []).find(byCode(code));
  }
};

/**
 * A position by code, or, when the positions list fails on the server (the same defect as the
 * units list), by the department establishment this loader budgets it in.
 */
const findPosition = async (api, position, department, isPlanned) => {
  try {
    return (await api.list(`${V1}/organization/positions`, { term: position.code })).find(
      byCode(position.code),
    );
  } catch (error) {
    if (!isServerError(error)) throw error;
    if (isPlanned(department)) return undefined;
    const rows = itemsOf(
      await api.get(`${V1}/organization/units/${department.record.id}/establishment`),
    );
    const row = rows[0];
    return row === undefined ? undefined : { id: row.positionId, code: position.code };
  }
};

export const organizationSteps = async ({ api, ensure, isPlanned }) => {
  const unitTypes = {};
  for (const type of UNIT_TYPES) {
    unitTypes[type.code] = await ensure(`unit type ${type.code}`, {
      find: async () => (await api.list(`${V1}/organization/unit-types`)).find(byCode(type.code)),
      create: () => api.post(`${V1}/organization/unit-types`, type),
    });
  }

  const unit = (definition) =>
    ensure(`unit ${definition.code}`, {
      find: () => findUnit(api, definition.code),
      create: () =>
        api.post(`${V1}/organization/units`, {
          unitTypeId: unitTypes[definition.typeCode].record.id,
          code: definition.code,
          name: definition.name,
          effectiveFrom: EFFECTIVE_FROM,
        }),
    });

  const company = await unit(COMPANY);
  const departments = {};
  for (const department of DEPARTMENTS) departments[department.code] = await unit(department);

  // A placement is found in the hierarchy: a unit that appears there is placed.
  const place = async (child, parent) =>
    ensure(`placement of ${child.record.code ?? 'a planned unit'}`, {
      find: async () => {
        if (isPlanned(child) || (parent && isPlanned(parent))) return undefined;
        const tree = await api.get(`${V1}/organization/hierarchy`);
        return unitsIn(tree?.roots ?? []).find((unit) => unit.id === child.record.id);
      },
      create: () =>
        api.post(`${V1}/organization/units/${child.record.id}/placement`, {
          ...(parent ? { parentUnitId: parent.record.id } : {}),
          effectiveFrom: EFFECTIVE_FROM,
        }),
    });
  await place(company);
  for (const department of Object.values(departments)) await place(department, company);

  const legalEntity = await ensure(`legal entity ${LEGAL_ENTITY.registrationNumber}`, {
    find: async () =>
      isPlanned(company)
        ? undefined
        : (await api.list(`${V1}/organization/legal-entities`)).find(
            (entity) => entity.unitId === company.record.id,
          ),
    create: () =>
      api.post(`${V1}/organization/units/${company.record.id}/legal-entity`, {
        ...LEGAL_ENTITY,
        effectiveFrom: EFFECTIVE_FROM,
      }),
  });

  const positions = {};
  for (const { departmentCode, ...position } of POSITIONS) {
    const department = departments[departmentCode];
    const entry = await ensure(`position ${position.code}`, {
      find: () => findPosition(api, position, department, isPlanned),
      create: () =>
        api.post(`${V1}/organization/positions`, { ...position, effectiveFrom: EFFECTIVE_FROM }),
    });
    positions[position.code] = entry;
    await ensure(`establishment of ${position.code} in ${departmentCode}`, {
      find: async () =>
        isPlanned(entry) || isPlanned(department)
          ? undefined
          : itemsOf(
              await api.get(`${V1}/organization/units/${department.record.id}/establishment`),
            ).find((row) => row.positionId === entry.record.id),
      create: () =>
        api.post(`${V1}/organization/establishment`, {
          positionId: entry.record.id,
          unitId: department.record.id,
          budgetedHeadcount: BUDGETED_HEADCOUNT,
          effectiveFrom: EFFECTIVE_FROM,
        }),
    });
  }
  return { company, departments, legalEntity, positions };
};

/** Publishes a definition still in draft. A published one is left alone. */
const publish = ({ api, ensure }, label, entry, path) =>
  isDraft(entry.record)
    ? ensure(`publish ${label}`, {
        find: async () => undefined,
        create: () => api.post(path, { expectedVersion: versionOf(entry.record) }),
      })
    : entry;

export const leaveSteps = async (context) => {
  const { api, ensure } = context;
  const leaveType = await ensure(`leave type ${LEAVE_TYPE.code}`, {
    find: async () => (await api.list(`${V1}/leave/types`)).find(byCode(LEAVE_TYPE.code)),
    create: () => api.post(`${V1}/leave/types`, LEAVE_TYPE),
  });
  await publish(
    context,
    LEAVE_TYPE.code,
    leaveType,
    `${V1}/leave/types/${leaveType.record.leaveTypeId}/publication`,
  );

  const policy = await ensure(`leave policy ${LEAVE_POLICY.code}`, {
    find: async () => (await api.list(`${V1}/leave/policies`)).find(byCode(LEAVE_POLICY.code)),
    create: () =>
      api.post(`${V1}/leave/policies`, {
        ...LEAVE_POLICY,
        leaveTypeId: leaveType.record.leaveTypeId,
        effectiveFrom: EFFECTIVE_FROM,
      }),
  });
  const policyPath = `${V1}/leave/policies/${policy.record.leavePolicyId}`;
  // A policy is assigned once published: Leave refuses an assignment of a draft.
  await publish(context, LEAVE_POLICY.code, policy, `${policyPath}/publication`);
  await ensure(`leave policy ${LEAVE_POLICY.code} tenant assignment`, {
    find: async () =>
      (policy.record.assignments ?? []).find((assignment) => assignment.scope === 'tenant'),
    create: () =>
      api.post(`${policyPath}/assignments`, { scope: 'tenant', effectiveFrom: EFFECTIVE_FROM }),
  });
  return { leaveType };
};

export const attendanceSteps = async (context) => {
  const { api, ensure } = context;
  const findShift = async () =>
    (await api.list(`${V1}/attendance/shifts`)).find(byCode(SHIFT.code));
  const existingShift = await findShift();
  // Attendance has no read of policies by code or id, and nothing later needs the policy's id. It
  // is created in the run that creates the shift, immediately before it, so a found shift means a
  // created policy. A run that died between the two is recovered by the refusal: since MW-071 a
  // repeated code is 409 `policy_code_taken`, which counts as present. An API from before MW-071
  // answers 500 instead; the loader then stops and names the manual step rather than retrying.
  if (existingShift === undefined && !context.options.skipAttendancePolicy) {
    try {
      await ensure(`attendance policy ${ATTENDANCE_POLICY.code}`, {
        find: async () => undefined,
        create: () =>
          api.post(`${V1}/attendance/policies`, {
            ...ATTENDANCE_POLICY,
            effectiveFrom: EFFECTIVE_FROM,
          }),
        conflictMeansExists: true,
      });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 500) throw error;
      throw new Error(
        `Attendance answered 500 to attendance policy ${ATTENDANCE_POLICY.code}. On an API ` +
          'without MW-071 that is how a repeated policy code is refused, so the policy most likely ' +
          'exists from an interrupted run while its shift does not. Manual step: confirm with the ' +
          `Work operator that the tenant holds attendance policy ${ATTENDANCE_POLICY.code}, then ` +
          're-run with --skip-attendance-policy. See tooling/testing-data/README.md.',
        { cause: error },
      );
    }
  }
  const shift = await ensure(`shift ${SHIFT.code}`, {
    find: async () => existingShift ?? findShift(),
    create: () => api.post(`${V1}/attendance/shifts`, SHIFT),
  });
  const shiftPath = `${V1}/attendance/shifts/${shift.record.shiftId}`;
  if (isDraft(shift.record)) {
    // A shift publishes only with a work segment. Segments are listed nowhere, so they are added
    // while the shift is a draft and a repeated sequence is refused as a conflict.
    for (const segment of SHIFT_SEGMENTS) {
      await ensure(`shift ${SHIFT.code} segment ${segment.sequence}`, {
        find: async () => undefined,
        create: () => api.post(`${shiftPath}/segments`, segment),
        conflictMeansExists: true,
      });
    }
  }
  await publish(context, SHIFT.code, shift, `${shiftPath}/publication`);

  const { workingPositions, ...definition } = SCHEDULE;
  const schedule = await ensure(`schedule ${SCHEDULE.code}`, {
    find: async () => (await api.list(`${V1}/attendance/schedules`)).find(byCode(SCHEDULE.code)),
    create: () => api.post(`${V1}/attendance/schedules`, definition),
  });
  const schedulePath = `${V1}/attendance/schedules/${schedule.record.scheduleId}`;
  if (isDraft(schedule.record) || schedule.created) {
    for (const cyclePosition of workingPositions) {
      await ensure(`schedule ${SCHEDULE.code} day ${cyclePosition}`, {
        find: async () => undefined,
        create: () =>
          api.post(`${schedulePath}/placements`, { cyclePosition, shiftId: shift.record.shiftId }),
        conflictMeansExists: true,
      });
    }
  }
  await publish(context, SCHEDULE.code, schedule, `${schedulePath}/publication`);
  return { schedule };
};

export const compensationSteps = async (context) => {
  const { api, ensure } = context;
  const component = await ensure(`component ${COMPONENT.code}`, {
    find: async () =>
      (await api.list(`${V1}/compensation/components`)).find(byCode(COMPONENT.code)),
    create: () => api.post(`${V1}/compensation/components`, COMPONENT),
  });
  await publish(
    context,
    COMPONENT.code,
    component,
    `${V1}/compensation/components/${component.record.componentId}/publication`,
  );

  const plan = await ensure(`plan ${PLAN.code}`, {
    find: async () => (await api.list(`${V1}/compensation/plans`)).find(byCode(PLAN.code)),
    create: () => api.post(`${V1}/compensation/plans`, PLAN),
  });
  const planPath = `${V1}/compensation/plans/${plan.record.compensationPlanId}`;
  await ensure(`plan ${PLAN.code} permits ${COMPONENT.code}`, {
    find: async () =>
      (plan.record.components ?? []).find(
        (one) => one.componentId === component.record.componentId,
      ),
    create: () =>
      api.post(`${planPath}/components`, {
        componentId: component.record.componentId,
        mandatory: true,
      }),
  });
  // Components are permitted on the draft; the plan is assigned once published.
  await publish(context, PLAN.code, plan, `${planPath}/publication`);
  await ensure(`plan ${PLAN.code} tenant assignment`, {
    find: async () => (plan.record.assignments ?? []).find((one) => one.scope === 'tenant'),
    create: () =>
      api.post(`${planPath}/assignments`, { scope: 'tenant', effectiveFrom: EFFECTIVE_FROM }),
  });
  return { component };
};

export const payrollSteps = async (context, { legalEntity, period }) => {
  const { api, ensure, isPlanned } = context;
  const group = await ensure(`payroll group ${PAYROLL_GROUP.code}`, {
    find: async () => (await api.list(`${V1}/payroll/groups`)).find(byCode(PAYROLL_GROUP.code)),
    create: () =>
      api.post(`${V1}/payroll/groups`, { ...PAYROLL_GROUP, legalEntityId: legalEntity.record.id }),
  });
  const { fixedAmountMinor, ...deduction } = DEDUCTION;
  await ensure(`deduction ${DEDUCTION.code}`, {
    find: async () =>
      isPlanned(group)
        ? undefined
        : (
            await api.list(`${V1}/payroll/deduction-definitions`, {
              payrollGroupId: group.record.payrollGroupId,
            })
          ).find(byCode(DEDUCTION.code)),
    create: () =>
      api.post(`${V1}/payroll/deduction-definitions`, {
        ...deduction,
        payrollGroupId: group.record.payrollGroupId,
        fixedAmount: money(fixedAmountMinor),
      }),
  });
  const opened = await ensure(`payroll period ${period.code}`, {
    find: async () =>
      (await api.list(`${V1}/payroll/periods`)).find(
        (one) => one.code === period.code && one.payrollGroupId === group.record.payrollGroupId,
      ),
    create: () =>
      api.post(`${V1}/payroll/periods`, { ...period, payrollGroupId: group.record.payrollGroupId }),
  });
  if (isDraft(opened.record)) {
    await ensure(`payroll period ${period.code} open`, {
      find: async () => undefined,
      create: () =>
        api.post(`${V1}/payroll/periods/${opened.record.payrollPeriodId}/status`, {
          status: 'open',
          expectedVersion: versionOf(opened.record),
        }),
    });
  }
};

export { money, V1 };
