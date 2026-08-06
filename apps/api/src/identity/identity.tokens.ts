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
