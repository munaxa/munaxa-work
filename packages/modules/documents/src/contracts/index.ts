/**
 * What consumers may depend on.
 *
 * The admin workspace and any later reader import from here rather than from the module's
 * internals — which is what the architecture gate enforces, and what keeps a screen from breaking
 * on a refactor it has no business knowing about.
 */
export * from './views.js';
