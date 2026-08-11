import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import {
  defineCompetency,
  defineFramework,
  retireFramework,
} from '../domain/competency-framework.js';
import { conflicted, notFound, refusedBy } from './performance-context.js';
import { PerformancePermissions } from './performance-permissions.js';
import type { LocalizedNameInput } from './localized.js';
import type { PerformanceDependencies } from './performance-dependencies.js';

/**
 * Competency frameworks, and the competencies within them.
 *
 * **A framework version is published, never edited.** `frameworkVersion` is part of the identity,
 * so redefining a competency means defining version 3 rather than rewriting version 2 — and a
 * review assessed under version 2 still reads as version 2 next year, because its snapshot holds
 * the definitions it was assessed against.
 *
 * **What a framework says about weights is binding on its competencies.** The third approved
 * scoring decision is that a competency aggregate is an unweighted mean unless the framework
 * explicitly carries weights, and that none are invented where it does not. So a weighted
 * framework's competencies must carry a weight and an unweighted one's must not — enforced by the
 * aggregate, and refused here before anything is written.
 *
 * **This is not what somebody has learned.** `person_capability` (Phase 4) holds what a person
 * claims; Learning (Phase 14) will hold what they have attained. This holds what a manager observed
 * of the job, against a definition a tenant wrote (D-9). Nothing in this file reads or writes
 * either of the other two.
 */

export interface DefineFrameworkCommand extends Command {
  readonly commandName: 'performance.define-framework';
  readonly code: string;
  readonly frameworkVersion: number;
  readonly name: LocalizedNameInput;
  readonly description?: LocalizedNameInput;
  readonly weighted: boolean;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
}

export interface FrameworkDefined {
  readonly frameworkId: string;
}

export const defineFrameworkHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<DefineFrameworkCommand, FrameworkDefined> => ({
  commandName: 'performance.define-framework',
  permission: PerformancePermissions.configure,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.frameworks.byCode(
        transaction,
        command.code,
        command.frameworkVersion,
      );

      if (existing !== undefined) return conflicted<FrameworkDefined>('framework_version_taken');

      const defined = defineFramework({ frameworkId: uuidV7(), ...command });

      if (!defined.ok) return refusedBy<FrameworkDefined>(defined.error);

      await dependencies.stores.frameworks.insert(transaction, defined.value);
      return success({ frameworkId: defined.value.frameworkId });
    }),
});

export interface DefineCompetencyCommand extends Command {
  readonly commandName: 'performance.define-competency';
  readonly frameworkId: string;
  readonly code: string;
  readonly name: LocalizedNameInput;
  readonly description?: LocalizedNameInput;
  readonly category: string;
  readonly weightBasisPoints?: number;
  readonly displayOrder: number;
  readonly levels: readonly {
    readonly ordinal: number;
    readonly name: LocalizedNameInput;
    readonly behaviouralIndicators?: readonly LocalizedNameInput[];
    readonly score: number;
  }[];
}

export interface CompetencyDefined {
  readonly competencyId: string;
}

export const defineCompetencyHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<DefineCompetencyCommand, CompetencyDefined> => ({
  commandName: 'performance.define-competency',
  permission: PerformancePermissions.configure,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const framework = await dependencies.stores.frameworks.byId(transaction, command.frameworkId);

      if (framework === undefined) {
        return notFound<CompetencyDefined>('performance_competency_framework');
      }

      const held = await dependencies.stores.frameworks.competenciesFor(
        transaction,
        command.frameworkId,
      );

      if (held.some((competency) => competency.code === command.code)) {
        return conflicted<CompetencyDefined>('competency_code_taken');
      }

      const competencyId = uuidV7();
      const defined = defineCompetency(framework, {
        competencyId,
        ...command,
        levels: command.levels.map((level) => ({ competencyLevelId: uuidV7(), ...level })),
      });

      if (!defined.ok) return refusedBy<CompetencyDefined>(defined.error);

      await dependencies.stores.frameworks.insertCompetency(
        transaction,
        defined.value.competency,
        defined.value.levels,
      );
      return success({ competencyId });
    }),
});

export interface RetireFrameworkCommand extends Command {
  readonly commandName: 'performance.retire-framework';
  readonly frameworkId: string;
  readonly expectedVersion: number;
}

export const retireFrameworkHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<RetireFrameworkCommand, FrameworkDefined> => ({
  commandName: 'performance.retire-framework',
  permission: PerformancePermissions.configure,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.frameworks.byId(transaction, command.frameworkId);

      if (held === undefined) return notFound<FrameworkDefined>('performance_competency_framework');

      const retired = retireFramework(held, dependencies.clock.now());

      if (!retired.ok) return refusedBy<FrameworkDefined>(retired.error);

      await dependencies.stores.frameworks.update(
        transaction,
        { ...retired.value, version: held.version },
        command.expectedVersion,
      );
      return success({ frameworkId: held.frameworkId });
    }),
});
