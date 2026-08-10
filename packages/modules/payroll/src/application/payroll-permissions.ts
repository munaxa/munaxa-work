/**
 * Payroll's permissions, and the two separations that matter most.
 *
 * **Reading a payroll is not reading a salary.** `payroll.read` sees that a run covered 1,400
 * people and produced a total; `payroll.read-result` sees what a named person was paid. Collapsing
 * them would make every payroll administrator a reader of every salary in the company, which is the
 * leakage this module exists to avoid.
 *
 * **Reading a figure is not reading the reason behind it.** An adjustment's note is the sentence
 * somebody wrote about why a person's pay changed, and it sits behind `payroll.adjust` — the Phase
 * 10 precedent, for the same reason.
 *
 * Beyond those: finalizing requires a stronger permission than viewing, approving is separate from
 * managing, and the accounting and payment outputs are separately held because a full payroll
 * accounting export is a full salary list by another name.
 */
export const PayrollPermissions = {
  read: 'payroll.read',
  readResult: 'payroll.read-result',
  readOwn: 'payroll.read-own',
  manage: 'payroll.manage',
  calculate: 'payroll.calculate',
  approve: 'payroll.approve',
  finalize: 'payroll.finalize',
  reverse: 'payroll.reverse',
  adjust: 'payroll.adjust',
  export: 'payroll.export',
  accounting: 'payroll.accounting',
  payment: 'payroll.payment',
} as const;

export type PayrollPermission = (typeof PayrollPermissions)[keyof typeof PayrollPermissions];

export const ALL_PAYROLL_PERMISSIONS: readonly string[] = Object.values(PayrollPermissions);
