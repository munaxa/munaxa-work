import type { Command, HandlerFailure, Result } from '@work/kernel';

import type { Metadata } from '../domain/organization-aggregate.js';

/**
 * The shapes an import is described by, in a file that imports neither the handler nor its
 * passes.
 *
 * They live here rather than beside the handler because both the handler and the passes need
 * them, and a shared type declared in one of two files that import each other is a cycle — which
 * the dependency gate refuses, correctly.
 */

/** Comfortably above any real organization chart, and far below a request timeout. */
export const IMPORT_LIMIT = 2000;

export interface ImportedUnitType {
  readonly code: string;
  readonly name: Readonly<Record<string, string>>;
  readonly ordinal: number;
  readonly allowedParentCodes?: readonly string[];
  readonly allowedAtRoot?: boolean;
  readonly carriesLegalEntity?: boolean;
}

export interface ImportedUnit {
  readonly code: string;
  readonly unitTypeCode: string;
  readonly name: Readonly<Record<string, string>>;
  readonly description?: Readonly<Record<string, string>>;
  readonly metadata?: Metadata;
  /** The *code* of the parent, not its identifier — a spreadsheet has no identifiers. */
  readonly parentCode?: string;
  readonly effectiveFrom: Date;
}

/** What a resumable pass produced: the identifiers by code, and how many were newly written. */
export interface Resolved {
  readonly byCode: ReadonlyMap<string, string>;
  readonly created: number;
  readonly reused: number;
}

/**
 * The subset of the module's commands import issues, as a callback rather than a dispatcher
 * reference.
 *
 * Import needs to *send commands*, and the dispatcher that would let it do so is assembled from
 * the handlers — including this one. Taking a sender keeps the module a plain declaration
 * instead of a graph with a cycle in it, and keeps the handler testable on its own.
 */
export interface CommandSender {
  send<TResult, TCommand extends Command>(
    command: TCommand,
  ): Promise<Result<TResult, HandlerFailure>>;
}
