import { Global, Module } from '@nestjs/common';

import { environmentProvider } from '../configuration/environment.provider.js';
import { LicenceSource } from './licence.source.js';
import { LicensingGate } from './licensing.gate.js';

/**
 * One licence source for the process, so the request guard, the operation gate and the headcount
 * check share one cache and one remembered last-good snapshot. Global because the identity
 * module's composition hands the gate to the dispatcher and to Employment.
 */
@Global()
@Module({
  providers: [environmentProvider, LicenceSource, LicensingGate],
  exports: [LicenceSource, LicensingGate],
})
export class LicensingModule {}
