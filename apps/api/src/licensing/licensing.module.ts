import { Global, Module } from '@nestjs/common';
import { readLicensing, type Environment } from '@work/config';
import type { UnitOfWork } from '@work/kernel';

import { ENVIRONMENT, environmentProvider } from '../configuration/environment.provider.js';
import { openEmploymentCounter } from '../employment/employment.composition.js';
import { DatabaseModule, UNIT_OF_WORK } from '../persistence/database.module.js';
import { LicenceSource, LICENSING_FETCH } from './licence.source.js';
import { LicensingGate } from './licensing.gate.js';
import { LICENSING_STATE_STORE, PostgresLicensingStateStore } from './licensing-state.store.js';
import { HourlyHeadcountReporter, NO_USAGE_REPORTS, USAGE_REPORTER } from './usage.reporter.js';

/**
 * One licence source for the process, so the request guard, the operation gate and the headcount
 * check share one cache and one remembered last-good snapshot, kept in `licensing_state`. Global because the identity
 * module's composition hands the gate to the dispatcher and to Employment.
 */
@Global()
@Module({
  imports: [DatabaseModule],
  providers: [
    environmentProvider,
    {
      provide: LICENSING_STATE_STORE,
      inject: [UNIT_OF_WORK],
      useFactory: (unitOfWork: UnitOfWork) => new PostgresLicensingStateStore(unitOfWork),
    },
    {
      provide: USAGE_REPORTER,
      inject: [ENVIRONMENT, UNIT_OF_WORK, { token: LICENSING_FETCH, optional: true }],
      useFactory: (environment: Environment, unitOfWork: UnitOfWork, fetchImpl?: typeof fetch) => {
        const licensing = readLicensing(environment);
        return licensing.kind === 'control-plane'
          ? new HourlyHeadcountReporter(
              licensing.configuration,
              openEmploymentCounter(unitOfWork),
              fetchImpl,
            )
          : NO_USAGE_REPORTS;
      },
    },
    LicenceSource,
    LicensingGate,
  ],
  exports: [LicenceSource, LicensingGate],
})
export class LicensingModule {}
