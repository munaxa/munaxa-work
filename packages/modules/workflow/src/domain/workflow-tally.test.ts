import { describe, expect, it } from 'vitest';

import { branchConfigurationIsUsable, tallyOf, thresholdFor, type BranchVote } from './branch.js';
import { BRANCH_RULES, type BranchRule } from './workflow-vocabulary.js';

/**
 * The tally arithmetic, against the numbers it was approved with.
 *
 * **Every parameter here was decided rather than derived**, so every one of them is asserted rather
 * than trusted to the implementation reading the way somebody intended. The cases below are the
 * exact examples the arithmetic was approved against — 1→1, 2→2, 3→2, 4→3, 5→3 — plus the boundaries
 * either side of each, because a majority is where an off-by-one silently changes who is approved.
 *
 * Integer arithmetic throughout: nothing here produces a fraction, and there is no weight and no
 * percentage to produce one from.
 */

const AT = new Date('2026-08-15T09:00:00.000Z');

const vote = (stepId: string, decision: 'approved' | 'rejected', minute = 0): BranchVote => ({
  stepId,
  decision,
  decidedAt: new Date(AT.getTime() + minute * 60_000),
});

const approvals = (count: number): readonly BranchVote[] =>
  Array.from({ length: count }, (_, index) => vote(`a${String(index)}`, 'approved', index));

const rejections = (count: number): readonly BranchVote[] =>
  Array.from({ length: count }, (_, index) => vote(`r${String(index)}`, 'rejected', index));

const outcomeOf = (
  rule: BranchRule,
  assigned: number,
  votes: readonly BranchVote[],
  quorum?: number,
): string => tallyOf(quorum === undefined ? { rule } : { rule, quorum }, assigned, votes).outcome;

describe('the majority threshold', () => {
  /** The approved table, exactly. `floor(assigned / 2) + 1` — strictly more than half. */
  it.each([
    [1, 1],
    [2, 2],
    [3, 2],
    [4, 3],
    [5, 3],
    [6, 4],
    [7, 4],
  ])('needs %i of %i approvals', (assigned, needed) => {
    expect(thresholdFor('majority', assigned)).toBe(needed);
  });

  /**
   * The case an even denominator makes and an odd one hides.
   *
   * Two of four is exactly half, and **a tie is not an approval**. A threshold written as
   * `ceil(n / 2)` would return 2 here and approve it, which is the single most likely way this
   * arithmetic could have been got wrong.
   */
  it('does not approve a tie', () => {
    expect(outcomeOf('majority', 4, [...approvals(2), ...rejections(2)])).toBe('rejected');
    expect(outcomeOf('majority', 2, [...approvals(1), ...rejections(1)])).toBe('rejected');
  });

  it('approves as soon as the threshold is reached, without waiting for the rest', () => {
    expect(outcomeOf('majority', 5, approvals(2))).toBe('awaiting');
    expect(outcomeOf('majority', 5, approvals(3))).toBe('approved');
  });

  /**
   * **Rejected the moment approval becomes arithmetically impossible**, not when everybody has
   * answered. Four voters need three; two rejections leave two possible approvals, and two is less
   * than three, so nobody needs to be asked again.
   */
  it('rejects when the threshold can no longer be reached', () => {
    expect(outcomeOf('majority', 4, rejections(1))).toBe('awaiting');
    expect(outcomeOf('majority', 4, rejections(2))).toBe('rejected');
    expect(outcomeOf('majority', 5, [...approvals(1), ...rejections(2)])).toBe('awaiting');
    expect(outcomeOf('majority', 5, [...approvals(1), ...rejections(3)])).toBe('rejected');
  });

  /** A non-response is never an exclusion: the denominator does not move, so the branch waits. */
  it('keeps waiting while anybody could still change the outcome', () => {
    expect(outcomeOf('majority', 3, approvals(1))).toBe('awaiting');
    expect(outcomeOf('majority', 3, [])).toBe('awaiting');
  });
});

describe('unanimous', () => {
  it('requires every assigned approver', () => {
    expect(thresholdFor('unanimous', 4)).toBe(4);
    expect(outcomeOf('unanimous', 3, approvals(2))).toBe('awaiting');
    expect(outcomeOf('unanimous', 3, approvals(3))).toBe('approved');
  });

  /**
   * One rejection ends it, and does so **without waiting for the others**.
   *
   * This is the approved rule, and it is also what the impossibility arithmetic produces on its own:
   * when the threshold is the denominator, a single rejection puts it out of reach. It is asserted
   * here rather than assumed from that, because the two agreeing is the property worth pinning.
   */
  it('rejects on the first rejection, whoever else has answered', () => {
    expect(outcomeOf('unanimous', 5, rejections(1))).toBe('rejected');
    expect(outcomeOf('unanimous', 5, [...approvals(3), ...rejections(1)])).toBe('rejected');
  });
});

describe('first response', () => {
  it('is decided by the first decision, whichever way it went', () => {
    expect(outcomeOf('first-response', 4, [vote('a', 'approved', 0)])).toBe('approved');
    expect(outcomeOf('first-response', 4, [vote('r', 'rejected', 0)])).toBe('rejected');
    expect(outcomeOf('first-response', 4, [])).toBe('awaiting');
  });

  /**
   * Two decisions that both reached the table: the earlier one wins.
   *
   * A branch terminates on the first response, so this should be unreachable — but two approvers of
   * one branch can commit concurrently, and a tally that answered by array order would report
   * different outcomes to two readers of identical rows.
   */
  it('takes the earlier decision when two arrive, and is stable when they tie', () => {
    expect(
      outcomeOf('first-response', 3, [vote('z', 'rejected', 5), vote('a', 'approved', 1)]),
    ).toBe('approved');
    // Same instant: settled by the step identifier, so every read agrees.
    expect(
      outcomeOf('first-response', 3, [vote('z', 'approved', 0), vote('a', 'rejected', 0)]),
    ).toBe('rejected');
    expect(
      outcomeOf('first-response', 3, [vote('a', 'rejected', 0), vote('z', 'approved', 0)]),
    ).toBe('rejected');
  });
});

describe('quorum', () => {
  /** A quorum does not approve anything. It decides whether the rule is consulted at all. */
  it('holds the branch awaiting until enough people have responded', () => {
    expect(outcomeOf('majority', 5, approvals(3), 4)).toBe('awaiting');
    expect(outcomeOf('majority', 5, approvals(4), 4)).toBe('approved');
  });

  /** In both directions: a rejection before quorum does not end the branch either. */
  it('gates a rejection as well as an approval', () => {
    expect(outcomeOf('unanimous', 5, rejections(1), 3)).toBe('awaiting');
    expect(outcomeOf('unanimous', 5, rejections(3), 3)).toBe('rejected');
  });

  /**
   * A quorum that can no longer be reached leaves the branch awaiting, and nothing rescues it.
   *
   * There is no timeout and no expiry in 16B: an approval waits until somebody acts on it. That is a
   * real operational state rather than a defect, and a screen showing it is telling the truth.
   */
  it('leaves an unreachable quorum awaiting rather than resolving it', () => {
    expect(outcomeOf('majority', 3, approvals(2), 3)).toBe('awaiting');
  });

  /** One is the default, so a branch with no quorum behaves exactly as it did before. */
  it('defaults to one, which is no gate at all', () => {
    expect(outcomeOf('unanimous', 1, approvals(1))).toBe('approved');
    expect(outcomeOf('unanimous', 1, approvals(1), 1)).toBe('approved');
  });
});

describe('one voter is legal', () => {
  /** Every rule agrees at a denominator of one, which is why every 16A chain still behaves as it did. */
  it.each(BRANCH_RULES)('approves a branch of one under %s', (rule) => {
    expect(thresholdFor(rule, 1)).toBe(1);
    expect(outcomeOf(rule, 1, approvals(1))).toBe('approved');
    expect(outcomeOf(rule, 1, rejections(1))).toBe('rejected');
    expect(outcomeOf(rule, 1, [])).toBe('awaiting');
  });
});

describe('a configuration a tenant could never satisfy', () => {
  it('refuses a branch with nobody in it', () => {
    const refused = branchConfigurationIsUsable({ rule: 'majority' }, 0);

    expect(refused.ok).toBe(false);
  });

  it('refuses a quorum larger than the branch', () => {
    expect(branchConfigurationIsUsable({ rule: 'majority', quorum: 4 }, 3).ok).toBe(false);
    expect(branchConfigurationIsUsable({ rule: 'majority', quorum: 3 }, 3).ok).toBe(true);
  });

  it('refuses a quorum that is not a whole number of one or more', () => {
    for (const quorum of [0, -1, 1.5, Number.NaN]) {
      expect([quorum, branchConfigurationIsUsable({ rule: 'majority', quorum }, 5).ok]).toEqual([
        quorum,
        false,
      ]);
    }
  });
});

describe('the tally itself', () => {
  it('reports the denominator, the counts and the threshold it used', () => {
    const tally = tallyOf({ rule: 'majority' }, 5, [...approvals(2), ...rejections(1)]);

    expect(tally).toMatchObject({
      rule: 'majority',
      assigned: 5,
      approvals: 2,
      rejections: 1,
      responses: 3,
      outstanding: 2,
      threshold: 3,
      quorum: 1,
      quorumMet: true,
      outcome: 'awaiting',
    });
  });

  /** Every number is a whole one. No rule, no denominator and no threshold produces a fraction. */
  it('produces only integers', () => {
    for (const assigned of [1, 2, 3, 7, 99]) {
      for (const rule of BRANCH_RULES) {
        const tally = tallyOf({ rule }, assigned, approvals(1));

        for (const value of [tally.assigned, tally.threshold, tally.outstanding, tally.quorum]) {
          expect([rule, assigned, Number.isInteger(value)]).toEqual([rule, assigned, true]);
        }
      }
    }
  });
});
