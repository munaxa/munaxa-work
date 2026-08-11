import type { Harness } from './compensation-test-harness.js';
import type { AssignRecurringCommand } from './recurring.use-case.js';

/**
 * The setup every application suite in this module shares: a configured tenant, and the three
 * one-line wrappers that send, try and ask through the dispatcher.
 *
 * Extracted rather than repeated, because two copies of a fixture are two fixtures that will differ
 * on the first change nobody mirrors — and because a configuration written twice is a chance for one
 * suite to test a plan the other does not have.
 */

export const jod = (
  minor: string,
): { amountMinor: string; currencyCode: string; currencyExponent: number } => ({
  amountMinor: minor,
  currencyCode: 'JOD',
  currencyExponent: 3,
});

export const sar = (
  minor: string,
): { amountMinor: string; currencyCode: string; currencyExponent: number } => ({
  amountMinor: minor,
  currencyCode: 'SAR',
  currencyExponent: 2,
});

export interface Configured {
  readonly employmentId: string;
  readonly planId: string;
  readonly basicId: string;
  readonly housingId: string;
  readonly bonusId: string;
}

/** A tenant with a published plan, a base component, a percentage allowance and a bonus. */
export const configure = async (
  harness: Harness,
  options: { readonly approvalRequired?: boolean } = {},
): Promise<Configured> => {
  const employmentId = harness.employment.addOne({ unitId: 'unit-1' });

  return harness.as('user:hr', async () => {
    const plan = await send<{ compensationPlanId: string }>(harness, {
      commandName: 'compensation.define-plan',
      code: 'standard',
      name: { en: 'Standard', ar: 'قياسي' },
      defaultCurrencyCode: 'JOD',
      defaultCurrencyExponent: 3,
      approvalRequired: options.approvalRequired ?? false,
      approvalsRequired: options.approvalRequired === true ? 1 : 0,
    });

    await send(harness, {
      commandName: 'compensation.publish-plan',
      compensationPlanId: plan.compensationPlanId,
      expectedVersion: 1,
    });
    await send(harness, {
      commandName: 'compensation.assign-plan',
      compensationPlanId: plan.compensationPlanId,
      scope: 'tenant',
      effectiveFrom: '2020-01-01',
    });

    const basic = await component(harness, 'basic', 'base', {});
    const housing = await component(harness, 'housing', 'allowance', {
      calculationBasis: 'percentage_of_component',
      basisComponentId: basic,
      percentageBasisPoints: 4000,
    });
    const bonus = await component(harness, 'annual-bonus', 'one_time', {});

    return {
      employmentId,
      planId: plan.compensationPlanId,
      basicId: basic,
      housingId: housing,
      bonusId: bonus,
    };
  });
};

export const component = async (
  harness: Harness,
  code: string,
  kind: string,
  overrides: Record<string, unknown>,
): Promise<string> => {
  const defined = await send<{ componentId: string }>(harness, {
    commandName: 'compensation.define-component',
    code,
    name: { en: code, ar: code },
    kind,
    calculationBasis: 'fixed_amount',
    roundingMode: 'half-up',
    payrollTreatmentCode: 'ordinary',
    ...overrides,
  });

  await send(harness, {
    commandName: 'compensation.publish-component',
    componentId: defined.componentId,
    expectedVersion: 1,
  });
  return defined.componentId;
};

export const send = async <TResult>(
  harness: Harness,
  command: Record<string, unknown>,
): Promise<TResult> => {
  const result = await harness.dispatcher.send<TResult>(
    command as unknown as AssignRecurringCommand,
  );

  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
  return result.value;
};

export const trySend = async (
  harness: Harness,
  command: Record<string, unknown>,
): ReturnType<Harness['dispatcher']['send']> =>
  harness.dispatcher.send(command as unknown as AssignRecurringCommand);

export const ask = async <TResult>(
  harness: Harness,
  query: Record<string, unknown>,
): Promise<TResult> => {
  const result = await harness.dispatcher.ask<TResult>(query as never);

  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
  return result.value;
};
