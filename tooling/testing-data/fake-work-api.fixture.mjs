/**
 * An in-memory fake of the Work API routes the synthetic loader uses, on node:http. It mirrors the
 * behaviour the loader depends on, as observed against the real API at 8a975f6: creates answer an
 * acknowledgement (`{ <thing>Id, code }`) rather than the view, definitions start as drafts and
 * publish with `expectedVersion`, Leave and Compensation refuse to assign a draft, a shift needs a
 * work segment to publish, a repeated schedule assignment is a 409, a repeated attendance policy
 * code is a 500, and (with `brokenOrganizationLists`) the units and positions lists answer 500.
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

export const FAKE_TOKEN = 'fake-loader-token-0123456789';

export const startFakeWorkApi = async ({ brokenOrganizationLists = false } = {}) => {
  const tables = new Map();
  const table = (name) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  };
  const requests = [];

  const add = (name, record) => {
    table(name).push(record);
    return record;
  };
  const one = (name, key, id) => table(name).find((record) => record[key] === id);
  const draft = (fields) => ({ ...fields, status: 'draft', version: 1 });

  const routes = [];
  const route = (method, pattern, handler) => routes.push({ method, pattern, handler });
  const V = '/api/v1';
  const conflict = (detail) => ({ status: 409, body: { status: 409, detail } });
  const failure = () => ({
    status: 500,
    body: { status: 500, detail: 'An unexpected error occurred.' },
  });
  const ok = (body) => ({ status: 200, body });
  const paged = (items) =>
    ok({ items, page: 1, pageSize: 200, total: items.length, totalPages: 1 });
  const byQuery = (items, query, keys) =>
    items.filter((item) => keys.every((key) => !query.has(key) || item[key] === query.get(key)));
  const publication = (name, key) => (match, body) => {
    const record = one(name, key, match[1]);
    if (record === undefined) return { status: 404, body: {} };
    if (record.version !== body.expectedVersion) return conflict('concurrent_modification');
    if (
      name === 'shifts' &&
      !table('segments').some((s) => s.shiftId === record.shiftId && s.kind === 'work')
    ) {
      return { status: 422, body: { detail: 'attendance.rejection.shift_has_no_work_segment' } };
    }
    Object.assign(record, { status: 'published', version: record.version + 1 });
    return ok({ status: 'published' });
  };

  // Organization
  route('GET', `${V}/organization/unit-types`, () => ok(table('unitTypes')));
  route('POST', `${V}/organization/unit-types`, (_, body) => {
    const record = add('unitTypes', { id: randomUUID(), ...body, status: 'active', version: 1 });
    return ok({ unitTypeId: record.id, code: record.code });
  });
  route('GET', `${V}/organization/units`, (_, __, query) =>
    brokenOrganizationLists
      ? failure()
      : paged(table('units').filter((unit) => unit.code.includes(query.get('term') ?? ''))),
  );
  route('POST', `${V}/organization/units`, (_, body) => {
    if (!one('unitTypes', 'id', body.unitTypeId)) return { status: 404, body: {} };
    const record = add('units', { id: randomUUID(), ...body, status: 'active', version: 1 });
    return ok({ unitId: record.id, code: record.code });
  });
  route('POST', `${V}/organization/units/([^/]+)/placement`, (match, body) => {
    add('placements', { unitId: match[1], parentUnitId: body.parentUnitId });
    return ok({ placed: true });
  });
  route('GET', `${V}/organization/hierarchy`, () => {
    const node = (unit) => ({
      unit,
      children: table('placements')
        .filter((placement) => placement.parentUnitId === unit.id)
        .map((placement) => node(one('units', 'id', placement.unitId))),
    });
    const roots = table('placements').filter((placement) => placement.parentUnitId === undefined);
    return ok({
      roots: roots.map((placement) => node(one('units', 'id', placement.unitId))),
      unplacedUnitIds: [],
    });
  });
  route('GET', `${V}/organization/legal-entities`, () => ok(table('legalEntities')));
  route('POST', `${V}/organization/units/([^/]+)/legal-entity`, (match, body) => {
    const record = add('legalEntities', { id: randomUUID(), unitId: match[1], ...body });
    return ok({ legalEntityId: record.id });
  });
  route('GET', `${V}/organization/positions`, (_, __, query) =>
    brokenOrganizationLists
      ? failure()
      : paged(
          table('positions').filter((position) => position.code.includes(query.get('term') ?? '')),
        ),
  );
  route('POST', `${V}/organization/positions`, (_, body) => {
    const record = add('positions', { id: randomUUID(), ...body });
    return ok({ positionId: record.id, code: record.code });
  });
  route('GET', `${V}/organization/units/([^/]+)/establishment`, (match) =>
    ok(table('establishment').filter((row) => row.unitId === match[1])),
  );
  route('POST', `${V}/organization/establishment`, (_, body) =>
    ok({ establishmentId: add('establishment', { id: randomUUID(), ...body }).id }),
  );

  // Leave
  route('GET', `${V}/leave/types`, () => ok(table('leaveTypes')));
  route('POST', `${V}/leave/types`, (_, body) =>
    ok(add('leaveTypes', draft({ leaveTypeId: randomUUID(), ...body }))),
  );
  route('POST', `${V}/leave/types/([^/]+)/publication`, publication('leaveTypes', 'leaveTypeId'));
  route('GET', `${V}/leave/policies`, () => ok(table('leavePolicies')));
  route('POST', `${V}/leave/policies`, (_, body) =>
    ok(add('leavePolicies', draft({ leavePolicyId: randomUUID(), assignments: [], ...body }))),
  );
  route(
    'POST',
    `${V}/leave/policies/([^/]+)/publication`,
    publication('leavePolicies', 'leavePolicyId'),
  );
  route('POST', `${V}/leave/policies/([^/]+)/assignments`, (match, body) => {
    const policy = one('leavePolicies', 'leavePolicyId', match[1]);
    if (policy.status !== 'published')
      return { status: 422, body: { detail: 'leave_policy_not_published' } };
    policy.assignments.push({ assignmentId: randomUUID(), ...body });
    return ok(policy);
  });
  route('GET', `${V}/leave/entitlements`, (_, __, query) =>
    ok({ items: byQuery(table('entitlements'), query, ['employmentId', 'leaveTypeId']) }),
  );
  route('POST', `${V}/leave/entitlements`, (_, body) =>
    ok(add('entitlements', { entitlementId: randomUUID(), ...body })),
  );

  // Attendance
  route('POST', `${V}/attendance/policies`, (_, body) =>
    table('attendancePolicies').some((policy) => policy.code === body.code)
      ? failure()
      : ok(add('attendancePolicies', draft({ policyId: randomUUID(), ...body }))),
  );
  route('GET', `${V}/attendance/shifts`, () => ok(table('shifts')));
  route('POST', `${V}/attendance/shifts`, (_, body) =>
    ok(add('shifts', draft({ shiftId: randomUUID(), ...body }))),
  );
  route('POST', `${V}/attendance/shifts/([^/]+)/segments`, (match, body) =>
    table('segments').some((s) => s.shiftId === match[1] && s.sequence === body.sequence)
      ? conflict('segment_exists')
      : ok(add('segments', { shiftId: match[1], ...body })),
  );
  route('POST', `${V}/attendance/shifts/([^/]+)/publication`, publication('shifts', 'shiftId'));
  route('GET', `${V}/attendance/schedules`, () => ok(table('schedules')));
  route('POST', `${V}/attendance/schedules`, (_, body) =>
    ok(add('schedules', draft({ scheduleId: randomUUID(), ...body }))),
  );
  route('POST', `${V}/attendance/schedules/([^/]+)/placements`, (match, body) =>
    ok(add('scheduleDays', { scheduleId: match[1], ...body })),
  );
  route(
    'POST',
    `${V}/attendance/schedules/([^/]+)/publication`,
    publication('schedules', 'scheduleId'),
  );
  route('POST', `${V}/attendance/schedules/([^/]+)/assignments`, (match, body) =>
    table('scheduleAssignments').some((a) => a.employmentId === body.employmentId)
      ? conflict('assignment_overlaps')
      : ok(add('scheduleAssignments', { scheduleId: match[1], ...body })),
  );

  // Compensation
  route('GET', `${V}/compensation/components`, () => ok(table('components')));
  route('POST', `${V}/compensation/components`, (_, body) =>
    ok(add('components', draft({ componentId: randomUUID(), ...body }))),
  );
  route(
    'POST',
    `${V}/compensation/components/([^/]+)/publication`,
    publication('components', 'componentId'),
  );
  route('GET', `${V}/compensation/plans`, () => ok(table('plans')));
  route('POST', `${V}/compensation/plans`, (_, body) =>
    ok(
      add(
        'plans',
        draft({ compensationPlanId: randomUUID(), assignments: [], components: [], ...body }),
      ),
    ),
  );
  route('POST', `${V}/compensation/plans/([^/]+)/components`, (match, body) => {
    one('plans', 'compensationPlanId', match[1]).components.push(body);
    return ok({});
  });
  route(
    'POST',
    `${V}/compensation/plans/([^/]+)/publication`,
    publication('plans', 'compensationPlanId'),
  );
  route('POST', `${V}/compensation/plans/([^/]+)/assignments`, (match, body) => {
    const plan = one('plans', 'compensationPlanId', match[1]);
    if (plan.status !== 'published') return conflict('plan_not_published');
    plan.assignments.push({ planAssignmentId: randomUUID(), ...body });
    return ok({});
  });
  route('GET', `${V}/compensation/recurring`, (_, __, query) =>
    ok({ items: byQuery(table('recurring'), query, ['employmentId', 'componentId']) }),
  );
  route('POST', `${V}/compensation/recurring`, (_, body) =>
    ok(add('recurring', { recurringId: randomUUID(), ...body })),
  );

  // Payroll
  route('GET', `${V}/payroll/groups`, () => ok(table('groups')));
  route('POST', `${V}/payroll/groups`, (_, body) =>
    ok({ payrollGroupId: add('groups', { payrollGroupId: randomUUID(), ...body }).payrollGroupId }),
  );
  route('GET', `${V}/payroll/deduction-definitions`, (_, __, query) =>
    ok(byQuery(table('deductions'), query, ['payrollGroupId'])),
  );
  route('POST', `${V}/payroll/deduction-definitions`, (_, body) =>
    ok(add('deductions', { deductionDefinitionId: randomUUID(), ...body })),
  );
  route('GET', `${V}/payroll/periods`, () => paged(table('periods')));
  route('POST', `${V}/payroll/periods`, (_, body) =>
    ok({
      payrollPeriodId: add('periods', draft({ payrollPeriodId: randomUUID(), ...body }))
        .payrollPeriodId,
    }),
  );
  route('POST', `${V}/payroll/periods/([^/]+)/status`, (match, body) => {
    const period = one('periods', 'payrollPeriodId', match[1]);
    if (period.version !== body.expectedVersion) return conflict('concurrent_modification');
    Object.assign(period, { status: body.status, version: period.version + 1 });
    return ok({ status: body.status });
  });

  // People and Employment
  route('GET', `${V}/people`, (_, __, query) =>
    paged(
      table('people').filter((person) => person.personNumber.includes(query.get('term') ?? '')),
    ),
  );
  route('POST', `${V}/people`, (_, body) => {
    if (table('people').some((person) => person.personNumber === body.personNumber))
      return conflict('person_number_taken');
    return ok({
      personId: add('people', { personId: randomUUID(), ...body }).personId,
      duplicates: 0,
    });
  });
  route('GET', `${V}/people/([^/]+)/profile`, (match) =>
    ok({
      person: one('people', 'personId', match[1]),
      contacts: table('contacts').filter((c) => c.personId === match[1]),
    }),
  );
  route('POST', `${V}/people/([^/]+)/contacts`, (match, body) =>
    ok(add('contacts', { contactId: randomUUID(), personId: match[1], ...body })),
  );
  route('GET', `${V}/employments`, (_, __, query) =>
    paged(byQuery(table('employments'), query, ['personId'])),
  );
  route('POST', `${V}/employments`, (_, body) =>
    ok(add('employments', { employmentId: randomUUID(), ...body })),
  );
  route('GET', `${V}/employments/([^/]+)/assignments`, (match) =>
    ok(table('assignments').filter((a) => a.employmentId === match[1])),
  );
  route('POST', `${V}/employments/([^/]+)/assignments`, (match, body) =>
    ok(add('assignments', { assignmentId: randomUUID(), employmentId: match[1], ...body })),
  );

  const server = createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    const url = new URL(request.url, 'http://fake');
    requests.push({
      method: request.method,
      path: url.pathname,
      body: text ? JSON.parse(text) : undefined,
    });
    const send = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (request.headers.authorization !== `Bearer ${FAKE_TOKEN}`)
      return send(401, { detail: 'Not authenticated.' });
    for (const { method, pattern, handler } of routes) {
      const match = new RegExp(`^${pattern}$`).exec(url.pathname);
      if (method === request.method && match) {
        const { status, body } = handler(match, text ? JSON.parse(text) : {}, url.searchParams);
        return send(status, body);
      }
    }
    return send(404, { detail: `no fake route for ${request.method} ${url.pathname}` });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    count: (name) => table(name).length,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};
