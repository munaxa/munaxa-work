import type { MoneyAmountView } from '@work/payroll/contracts';

import type { Language } from './locale';

/**
 * The values these screens must not alter, and the named functions that stop them.
 *
 * Payroll publishes four kinds of value a screen destroys by formatting them, and money is the one
 * that destroys a customer's trust rather than merely their patience.
 *
 * **An amount is a decimal string and it never becomes a number.** `MoneyAmountView` carries exact
 * minor units as a string *and* the decimal rendering beside it, precisely because a JSON number
 * loses precision above 2^53 and invites a `Number()` at the far end — which is where a payslip
 * loses a fil. Nothing here parses, rounds, converts, sums or compares an amount. The screen
 * renders `amount` as published and puts `currencyCode` beside it as its own token; a total across
 * currencies is a thing the module deliberately never produces, so no screen may produce one either.
 *
 * **A civil date is a day somebody agreed.** `periodStart`, `periodEnd` and `paymentDate` are
 * `YYYY-MM-DD` strings; putting one through `new Date(...).toLocaleDateString()` in a process west
 * of Greenwich renders the day before, which on a payment date is a different pay run.
 *
 * **An instant is a moment and must stay the same moment.** `calculatedAt`, `approvedAt`,
 * `finalizedAt`, `staleDetectedAt`, `recordedAt` and `decidedAt` are instants, rendered with
 * `toLocaleString` **pinned to UTC** — the shape the workflow, hiring and documents screens already
 * use. Unpinned, the same run reads as approved on a different day depending on where this process
 * runs.
 *
 * **A count is a whole number the server decided.** `populationSize`, `resultCount`,
 * `exceptionCount`, `staleCount`, a page total, a sequence, a version — all `String`, never
 * `toLocaleString`, which localizes the digits and inserts a thousands separator the moment a
 * tenant grows past a thousand employees.
 *
 * **Nothing here computes.** No net from gross minus deductions, no variance, no percentage, no
 * "current run", no period duration, no total of a column. Every one of those is either published
 * by Payroll or is a payroll rule this screen has no business inventing.
 */

/** An absent value. A dash rather than an empty cell, which reads as a rendering fault. */
export const DASH = '—';

const locale = (language: Language): string => (language === 'ar' ? 'ar' : 'en-GB');

/** A civil date, exactly as the module stored it. */
export const day = (value: string | undefined): string => value ?? DASH;

/** An instant, in the reader's language and pinned to UTC. */
export const instant = (value: Date | string | undefined, language: Language): string =>
  value === undefined
    ? DASH
    : new Date(value).toLocaleString(locale(language), { timeZone: 'UTC' });

/** A whole count, sequence or version the API reported, as text. */
export const count = (value: number | undefined): string =>
  value === undefined ? DASH : String(value);

/**
 * A reference to something another module owns, in full and never shortened.
 *
 * Payroll holds no name and no personal data at all (ADR-0038), so an employment on a result, an
 * exception or a payment instruction is an identifier and stays one. Shortening it would make two
 * employments created in the same window render identically, and resolving it would mean caching a
 * name this screen does not own.
 */
export const reference = (value: string | undefined): string => value ?? DASH;

/**
 * The two halves of a published amount, kept apart.
 *
 * The figure and its currency are returned as separate fields and are rendered as separate tokens:
 * the amount is tabular so a column of them lines up on the decimal point, and the code sits beside
 * it as a muted unit rather than being concatenated into the number's own run. `250.000 JOD` as one
 * string is a string; as two tokens it is a quantity and its unit, which is what it is.
 *
 * Absent means absent. No zero is substituted, and no currency is inferred, defaulted or converted.
 */
export interface Amount {
  readonly figure: string;
  readonly currency: string;
}

export const amountOf = (money: MoneyAmountView | undefined): Amount | undefined =>
  money === undefined ? undefined : { figure: money.amount, currency: money.currencyCode };
