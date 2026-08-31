/**
 * Injection tokens for the two seams the request pipeline depends on.
 *
 * Both are interfaces, and TypeScript interfaces do not survive to runtime, so Nest needs a
 * symbol to resolve them by. Declared in their own file because the tenancy middleware and the
 * identity module both need them, and having either import the other would be a cycle.
 */

/** Platform's implementation. This repository ships only the one that authenticates nobody. */
export const AUTHENTICATION_PORT = Symbol('AUTHENTICATION_PORT');

/**
 * The tenant's authorization: its stored role assignments, and Platform's resolver over them.
 *
 * A token of its own rather than an expression inside the checker's factory, because the resolver
 * memoises each tenant's role graph and administration has to invalidate *that* instance. Two
 * would mean a role edited through one and still conferring its old grants through the other.
 */
export const AUTHORIZATION = Symbol('AUTHORIZATION');

/** Which tenants an authenticated person may act in. Supplied by Workforce Identity. */
export const MEMBERSHIP_DIRECTORY = Symbol('MEMBERSHIP_DIRECTORY');

/** The CQRS dispatcher, with every module's handlers registered. */
export const DISPATCHER = Symbol('DISPATCHER');

/** The module registry, from which permissions, navigation and health are derived. */
export const MODULE_REGISTRY = Symbol('MODULE_REGISTRY');

/**
 * The three deferred senders, in one provider.
 *
 * Each module's bulk import sends the same commands an administrator would, and the dispatcher that
 * receives them is assembled from a handler list that *includes* import — a genuine cycle, closed
 * by handing each sender its dispatcher the moment one exists. Employment uses its sender for one
 * thing more: it reaches People and Organization through their published queries rather than their
 * tables, and those queries are on the same dispatcher.
 *
 * They are one token rather than three because the composition root's factories take them together,
 * and a factory with six parameters is one the standards refuse — correctly: a parameter list that
 * long is a list somebody eventually passes in the wrong order.
 */
export const DEFERRED_SENDERS = Symbol('DEFERRED_SENDERS');

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

/**
 * Every module that needs the permission checker, assembled together.
 *
 * People, Documents and Letters each build their answer from what the caller holds rather than
 * refusing outright — People redacts a person's sensitive fields, Documents withholds confidential
 * documents, Letters refuses a salary template to an issuer without the pay permission — so all
 * three need to *ask*, not merely be checked.
 *
 * One token rather than three because the registry factory takes them together, and a factory with
 * six parameters is one the standards refuse: correctly, because a parameter list that long is a
 * list somebody eventually passes in the wrong order.
 */
export const PERMISSION_AWARE_MODULES = Symbol('PERMISSION_AWARE_MODULES');
