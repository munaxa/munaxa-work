/**
 * Career and succession planning: paths and the stages along them, individual career plans, talent
 * pools and who was in them, succession plans and the people nominated against them, readiness
 * statements, development plans, and mobility recommendations.
 *
 * **Career recommends and executes nothing.** No employment, position, assignment or salary changes
 * because of anything in this module, and there is no port through which one could
 * ([ADR-0072](../../../docs/adr/0072-a-career-recommendation-is-advisory-and-writes-nothing.md)).
 * `accepted` on a mobility recommendation means a human agreed with a suggestion.
 *
 * **A decision is Career's; an observation stays where it was made**
 * ([ADR-0073](../../../docs/adr/0073-a-decision-is-careers-an-observation-stays-where-it-was-made.md)).
 * Pool membership is a standing decision an organization took; Performance's nine-box placement is
 * an observation one cycle made. Neither derives the other. A development item that is a course
 * references a Learning assignment and carries no status of its own.
 *
 * **Readiness is stated by a person, and no formula replaces them**
 * ([ADR-0074](../../../docs/adr/0074-readiness-is-stated-by-a-person.md)). The 70-20-10 development
 * mix is `NOT VERIFIED`: a category is recorded and counted, and nothing validates a balance.
 *
 * **This module holds no money, no rate and no computed number.** Every value it stores is a small
 * ordered integer a human chose — a stage's position, a successor's rank, a readiness level's
 * ordinal — so there is no rounding rule to get wrong and no floating-point arithmetic in it. Every
 * date is a `YYYY-MM-DD` civil date end to end.
 */
export * from './domain/career-vocabulary.js';
export * from './domain/career-rejection.js';
export * from './domain/path.js';
export * from './domain/plan.js';
export * from './domain/pool.js';
export * from './domain/succession.js';
export * from './domain/readiness.js';
export * from './domain/development.js';
export * from './domain/mobility.js';

export * from './application/career-module.js';
export * from './application/career-permissions.js';
export * from './application/career-dependencies.js';
export * from './application/career-ports.js';
export * from './application/in-memory-stores.js';
export * from './application/career-views.js';
