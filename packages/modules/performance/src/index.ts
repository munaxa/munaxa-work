/**
 * Performance management: goals, competency frameworks, review cycles, assessments, calibration,
 * talent classification and continuous feedback.
 *
 * **This module measures performance and decides nothing.** It changes no salary, no position, no
 * employment status and no learning record. It publishes outcomes — a rating, a nine-box placement
 * — that Compensation, Learning and Career may pull when they want them (AD-005).
 *
 * **The scoring semantics are the approved D-6 decisions, implemented in `scoring.ts` and nowhere
 * else.** Integer basis points for weights, integer hundredths for scores, nearest-half-away-from-
 * zero rounding, missing and cancelled work excluded from the denominator with its reason recorded,
 * and a score outside the rating scale's range treated as a **failure rather than something to
 * clamp**.
 *
 * **Nothing here is anonymous.** Every row records its author, row-level security is tenant-scoped
 * and the audit columns name the actor. A minimum respondent count withholds an aggregate; it does
 * not make the rows behind it anonymous, and this module makes no claim that it does.
 */
export * from './domain/performance-vocabulary.js';
export * from './domain/performance-rejection.js';
export * from './domain/scoring.js';
export * from './domain/rating-scale.js';
export * from './domain/competency-framework.js';
export * from './domain/review-template.js';
export * from './domain/goal.js';
export * from './domain/cycle.js';
export * from './domain/review.js';
export * from './domain/assessment.js';
export * from './domain/calibration.js';
export * from './domain/talent-placement.js';
export * from './domain/feedback.js';
export * from './domain/review-snapshot.js';
