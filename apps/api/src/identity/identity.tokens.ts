/**
 * Injection tokens for the two seams the request pipeline depends on.
 *
 * Both are interfaces, and TypeScript interfaces do not survive to runtime, so Nest needs a
 * symbol to resolve them by. Declared in their own file because the tenancy middleware and the
 * identity module both need them, and having either import the other would be a cycle.
 */

/** Platform's implementation. This repository ships only the one that authenticates nobody. */
export const AUTHENTICATION_PORT = Symbol('AUTHENTICATION_PORT');

/** Which tenants an authenticated person may act in. Supplied by Workforce Identity. */
export const MEMBERSHIP_DIRECTORY = Symbol('MEMBERSHIP_DIRECTORY');

/** The CQRS dispatcher, with every module's handlers registered. */
export const DISPATCHER = Symbol('DISPATCHER');

/** The module registry, from which permissions, navigation and health are derived. */
export const MODULE_REGISTRY = Symbol('MODULE_REGISTRY');

/**
 * A command sender handed its dispatcher after the dispatcher is built.
 *
 * Organization's bulk import sends the same commands an administrator would, and the dispatcher
 * that receives them is assembled from a handler list that includes import. This is the seam
 * that breaks the cycle without letting import bypass the application service.
 */
export const COMMAND_SENDER = Symbol('COMMAND_SENDER');

/** The same seam for People's bulk import, which sends `people.create-person` per row. */
export const PEOPLE_COMMAND_SENDER = Symbol('PEOPLE_COMMAND_SENDER');

/**
 * The permission checker, exposed as a token as well as being wired into the dispatcher.
 *
 * People's *reads* assemble their answer from what the caller holds — a caller who may read the
 * register but not its sensitive fields gets the person with those fields withheld rather than a
 * 403 — so the module needs to ask, not merely be checked.
 */
export const PERMISSION_CHECKER = Symbol('PERMISSION_CHECKER');

/**
 * People's assembled module.
 *
 * A provider of its own rather than an expression inside the registry factory, because People
 * needs the application's logger — its disclosure log writes through it — and a factory that
 * assembled four modules with four different dependency lists would be the longest function in
 * the composition root.
 */
export const PEOPLE_MODULE = Symbol('PEOPLE_MODULE');
