import type { Command, CommandHandler, Query, QueryHandler, WorkModule } from '@work/kernel';

import { ALL_LEAVE_PERMISSIONS, LeavePermissions } from './leave-permissions.js';
import { amendLeaveRequestHandler } from './amendment.use-case.js';
import { cancelLeaveRequestHandler, withdrawLeaveRequestHandler } from './cancellation.use-case.js';
import { decideLeaveRequestHandler } from './decision.use-case.js';
import { adjustBalanceHandler, grantEntitlementHandler } from './entitlement.use-case.js';
import { expireCarryOverHandler } from './expiry.use-case.js';
import { closeLeaveYearHandler } from './leave-year.use-case.js';
import {
  assignLeavePolicyHandler,
  declareBlackoutHandler,
  defineLeavePolicyHandler,
  publishLeavePolicyHandler,
} from './policy.use-case.js';
import { recalculateBalancesHandler } from './recalculate.use-case.js';
import { raiseLeaveRequestHandler, submitLeaveRequestHandler } from './request.use-case.js';
import { runAccrualHandler } from './accrual.use-case.js';
import { defineLeaveTypeHandler, publishLeaveTypeHandler } from './type.use-case.js';
import {
  readBalanceAsOfHandler,
  readBalancesHandler,
  readLedgerHandler,
  readProjectedBalanceHandler,
} from './balance-queries.js';
import {
  listAccrualRunsHandler,
  listAdjustmentsHandler,
  listEntitlementsHandler,
  listPoliciesHandler,
  listTypesHandler,
  readDashboardHandler,
} from './definition-queries.js';
import { approvedLeaveAffectingHandler, approvedLeaveForHandler } from './directory-queries.js';
import { balancesAwaitingRecalculationHandler } from './reconciliation-query.js';
import {
  readApprovalChainHandler,
  readCalendarHandler,
  readRequestHandler,
  searchRequestsHandler,
} from './request-queries.js';
import type { LeaveDependencies } from './leave-dependencies.js';

/**
 * The module's declaration: what Leave offers, in one place, so the registry can derive everything
 * else — permissions, navigation, health.
 *
 * There is no `sender` parameter here, and its absence is worth noting. Attendance needed one
 * because its import command sends the same command a turnstile does, which is a genuine cycle in
 * its own handler list. Leave has no such cycle: nothing in this module sends a Leave command, and
 * the two cross-module reads are **ports**, resolved by the composition root against Employment's
 * and Attendance's published services under bounded service grants.
 */
export const leaveModule = (dependencies: LeaveDependencies): WorkModule => ({
  name: 'leave',

  commands: commandsOf(dependencies),

  queries: queriesOf(dependencies),

  navigation: [
    {
      key: 'leave.requests',
      path: '/leave',
      permission: LeavePermissions.read,
      order: 45,
    },
  ],

  // The read permissions no handler declares alone are stated here too, so the administration
  // screen offers the whole set rather than the subset that happens to be a handler's own.
  permissions: ALL_LEAVE_PERMISSIONS,
});

const commandsOf = (dependencies: LeaveDependencies): readonly CommandHandler<Command, unknown>[] =>
  [
    defineLeaveTypeHandler(dependencies),
    publishLeaveTypeHandler(dependencies),

    defineLeavePolicyHandler(dependencies),
    publishLeavePolicyHandler(dependencies),
    assignLeavePolicyHandler(dependencies),
    declareBlackoutHandler(dependencies),

    grantEntitlementHandler(dependencies),
    adjustBalanceHandler(dependencies),

    raiseLeaveRequestHandler(dependencies),
    submitLeaveRequestHandler(dependencies),
    decideLeaveRequestHandler(dependencies),
    withdrawLeaveRequestHandler(dependencies),
    cancelLeaveRequestHandler(dependencies),
    amendLeaveRequestHandler(dependencies),

    runAccrualHandler(dependencies),
    closeLeaveYearHandler(dependencies),
    expireCarryOverHandler(dependencies),

    recalculateBalancesHandler(dependencies),
  ] as readonly CommandHandler<Command, unknown>[];

const queriesOf = (dependencies: LeaveDependencies): readonly QueryHandler<Query, unknown>[] =>
  [
    listTypesHandler(dependencies),
    listPoliciesHandler(dependencies),
    listEntitlementsHandler(dependencies),
    listAdjustmentsHandler(dependencies),
    listAccrualRunsHandler(dependencies),
    readDashboardHandler(dependencies),

    readBalancesHandler(dependencies),
    readBalanceAsOfHandler(dependencies),
    readProjectedBalanceHandler(dependencies),
    readLedgerHandler(dependencies),
    balancesAwaitingRecalculationHandler(dependencies),

    searchRequestsHandler(dependencies),
    readRequestHandler(dependencies),
    readApprovalChainHandler(dependencies),
    readCalendarHandler(dependencies),

    // The two Attendance calls. The whole of Leave's published cross-module surface.
    approvedLeaveForHandler(dependencies),
    approvedLeaveAffectingHandler(dependencies),
  ] as readonly QueryHandler<Query, unknown>[];
