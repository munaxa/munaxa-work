/**
 * The public contract of Employee Relations.
 *
 * This is the entire surface other modules, the API and the SDK may depend on. Its handlers, its
 * stores, its tables and its aggregates are private and stay private, because the moment a second
 * module reads `relation_violation` directly the boundary stops being a boundary — and in this
 * domain the boundary is also the access trail.
 *
 * Contracts are versioned. A breaking change to anything in this file requires an ADR.
 */

export type {
  LocalizedTextView,
  ViolationCategoryView,
  ViolationPageView,
  ViolationView,
} from './views.js';
