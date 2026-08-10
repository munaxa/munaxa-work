import { success, type Query, type QueryHandler } from '@work/kernel';

import { PayrollPermissions } from './payroll-permissions.js';
import { accountingView, paymentView } from './payroll-views.js';
import type { PayrollDependencies } from './payroll-dependencies.js';
import type { AccountingLineView, PaymentInstructionView } from '../contracts/views.js';

/**
 * The two outputs, each behind its own permission.
 *
 * Separate from `payroll.read-result` and from each other because **a full payroll accounting
 * export is a full salary list by another name**, and a payment file is the same list with payment
 * dates attached. Somebody who reconciles journals does not thereby need to see what anybody was
 * paid individually, and somebody who prepares payments does not need the accounting breakdown.
 *
 * Both are **prepared and acted on by nothing**. There is no Finance module to post to and no
 * payment rail to transmit on, so neither read has a side effect and neither carries a state
 * claiming otherwise (ADR-0067).
 */

const DEFAULT_PAGE = 100;
const MAX_PAGE = 500;

const bounded = (size: number | undefined): number =>
  Math.min(Math.max(size ?? DEFAULT_PAGE, 1), MAX_PAGE);

export interface ReadAccountingOutput extends Query {
  readonly queryName: 'payroll.accounting-output';
  readonly payrollRunId: string;
  readonly page?: number;
  readonly size?: number;
}

export interface AccountingPage {
  readonly items: readonly AccountingLineView[];
  readonly total: number;
}

export const readAccountingOutputHandler = (
  dependencies: PayrollDependencies,
): QueryHandler<ReadAccountingOutput, AccountingPage> => ({
  queryName: 'payroll.accounting-output',
  permission: PayrollPermissions.accounting,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const size = bounded(query.size);
      const page = await dependencies.stores.accounting.forRun(transaction, query.payrollRunId, {
        limit: size,
        offset: ((query.page ?? 1) - 1) * size,
      });

      return success({ items: page.items.map(accountingView), total: page.total });
    }),
});

export interface ReadPaymentInstructions extends Query {
  readonly queryName: 'payroll.payment-instructions';
  readonly payrollRunId: string;
  readonly page?: number;
  readonly size?: number;
}

export interface PaymentPage {
  readonly items: readonly PaymentInstructionView[];
  readonly total: number;
}

/**
 * Payment instructions, carrying **no credential of any kind**.
 *
 * No account number, no IBAN, no sort code, no card token. `payeeAccountRef` is reserved and null
 * in this phase; there is no bank-account domain to populate it from, and no adapter that could
 * execute one of these.
 */
export const readPaymentInstructionsHandler = (
  dependencies: PayrollDependencies,
): QueryHandler<ReadPaymentInstructions, PaymentPage> => ({
  queryName: 'payroll.payment-instructions',
  permission: PayrollPermissions.payment,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const size = bounded(query.size);
      const page = await dependencies.stores.payments.forRun(transaction, query.payrollRunId, {
        limit: size,
        offset: ((query.page ?? 1) - 1) * size,
      });

      return success({ items: page.items.map(paymentView), total: page.total });
    }),
});
