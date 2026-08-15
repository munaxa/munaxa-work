import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type {
  ArchiveSuccessionPlanCommand,
  MoveSuccessionPlanCommand,
} from '../application/succession.use-case.js';
import type { NominateSuccessorCommand } from '../application/successor.use-case.js';

import { CareerDispatcher } from './career-dispatcher.js';
import { NominateSuccessorBody } from './career-people.dto.js';
import { VersionedBody } from './career.dto.js';
import { present } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * What changes a succession plan: activating it, archiving it, and putting somebody on it.
 *
 * The same prefix as `CareerSuccessionController` and declared immediately after it, so the reads
 * resolve first. The split is along a real seam rather than a line count: everything on the other
 * controller answers a question about a bench, and everything here changes what an organization has
 * committed to about named people.
 *
 * **Activation is not a formality.** A bench with nobody on it does not activate — an "active"
 * succession plan with no successors reads to a review as cover that does not exist.
 *
 * **Nominating is not confirming**, and the two are separate permissions. This controller carries
 * only the nomination; confirmation and withdrawal address the nomination by its own identifier on
 * `career/successors`, because by then it is a record in its own right.
 */
@ApiTags('career')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'career/succession-plans', version: '1' })
export class CareerSuccessionLifecycleController {
  public constructor(private readonly dispatcher: CareerDispatcher) {}

  @Post(':successionPlanId/activation')
  @ApiOperation({ summary: 'Activate a bench' })
  public async activate(
    @Param('successionPlanId', ParseUUIDPipe) successionPlanId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, MoveSuccessionPlanCommand>({
        commandName: 'career.activate-succession-plan',
        successionPlanId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }

  @Post(':successionPlanId/archive')
  @ApiOperation({ summary: 'Archive a bench. Terminal; an archived one does not reactivate' })
  public async archive(
    @Param('successionPlanId', ParseUUIDPipe) successionPlanId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ArchiveSuccessionPlanCommand>({
        commandName: 'career.archive-succession-plan',
        successionPlanId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }

  @Post(':successionPlanId/successors')
  @ApiOperation({ summary: 'Put somebody forward. Nominating is not confirming' })
  public async nominate(
    @Param('successionPlanId', ParseUUIDPipe) successionPlanId: string,
    @Body() body: NominateSuccessorBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, NominateSuccessorCommand>({
        commandName: 'career.nominate-successor',
        successionPlanId,
        employmentId: body.employmentId,
        ...present({ readinessLevelId: body.readinessLevelId, rank: body.rank }),
      }),
    );
  }
}
