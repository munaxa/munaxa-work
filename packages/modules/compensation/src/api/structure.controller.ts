import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type {
  DefinePayGradeCommand,
  DefinePayScaleCommand,
  DefineSalaryStepCommand,
  DefineSalaryStructureCommand,
} from '../application/structure.use-case.js';
import type {
  ListGrades,
  ListScales,
  ListSteps,
  ListStructures,
} from '../application/definition-queries.js';

import {
  DefineGradeBody,
  DefineScaleBody,
  DefineStepBody,
  DefineStructureBody,
} from './structure.dto.js';
import { CompensationDispatcher } from './compensation-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Salary structures and pay grades.
 *
 * **Every level is optional.** A tenant that pays simple salaries configures none of this, and the
 * lists stay empty. A grade constrains an amount and never supplies one — nothing here computes a
 * payment.
 */
@ApiTags('compensation')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'compensation', version: '1' })
export class CompensationStructureController {
  public constructor(private readonly dispatcher: CompensationDispatcher) {}

  @Get('structures')
  @ApiOperation({ summary: 'The configured salary structures. Optional, and often none' })
  @ApiOkResponse({ description: 'Every structure this tenant has defined.' })
  public async structures(): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListStructures>({ queryName: 'compensation.structures' }),
    );
  }

  @Post('structures')
  @ApiOperation({ summary: 'Draft a salary structure' })
  public async defineStructure(@Body() body: DefineStructureBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DefineSalaryStructureCommand>({
        commandName: 'compensation.define-structure',
        ...body,
      }),
    );
  }

  @Get('grades')
  @ApiOperation({ summary: 'Pay grades — a minimum, a midpoint and a maximum, effective-dated' })
  public async grades(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListGrades>({
        queryName: 'compensation.grades',
        ...(query['salaryStructureId'] === undefined
          ? {}
          : { salaryStructureId: query['salaryStructureId'] }),
      }),
    );
  }

  @Post('grades')
  @ApiOperation({ summary: 'Draft a pay grade' })
  public async defineGrade(@Body() body: DefineGradeBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DefinePayGradeCommand>({
        commandName: 'compensation.define-grade',
        ...body,
      }),
    );
  }

  @Get('scales')
  @ApiOperation({ summary: 'Pay scales within a grade' })
  public async scales(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListScales>({
        queryName: 'compensation.scales',
        ...(query['payGradeId'] === undefined ? {} : { payGradeId: query['payGradeId'] }),
      }),
    );
  }

  @Post('scales')
  @ApiOperation({ summary: 'Draft a pay scale' })
  public async defineScale(@Body() body: DefineScaleBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DefinePayScaleCommand>({
        commandName: 'compensation.define-scale',
        ...body,
      }),
    );
  }

  @Get('steps')
  @ApiOperation({ summary: 'Salary steps. Nothing here progresses an employment automatically' })
  public async steps(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListSteps>({
        queryName: 'compensation.steps',
        ...(query['payScaleId'] === undefined ? {} : { payScaleId: query['payScaleId'] }),
        ...(query['payGradeId'] === undefined ? {} : { payGradeId: query['payGradeId'] }),
      }),
    );
  }

  @Post('steps')
  @ApiOperation({ summary: 'Define a salary step. Its amount is copied onto an assignment' })
  public async defineStep(@Body() body: DefineStepBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DefineSalaryStepCommand>({
        commandName: 'compensation.define-step',
        ...body,
      }),
    );
  }
}
