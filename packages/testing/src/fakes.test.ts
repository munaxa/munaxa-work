import { describe, expect, it } from 'vitest';

import {
  InMemoryUnitOfWork,
  RecordingDispatcher,
  denyAll,
  inTestTenant,
  permitting,
} from './fakes.js';
import { anEvent, aTenantId } from './builders.js';

describe('InMemoryUnitOfWork', () => {
  it('publishes collected events on success, as the real one does', async () => {
    const unitOfWork = new InMemoryUnitOfWork(aTenantId());

    await unitOfWork.execute((transaction) => {
      transaction.collect([anEvent('probe.happened')]);
      return Promise.resolve(null);
    });

    expect(unitOfWork.events.publishedNames()).toEqual(['probe.happened']);
  });

  it('publishes nothing when the work throws, as the real one does', async () => {
    const unitOfWork = new InMemoryUnitOfWork(aTenantId());

    await expect(
      unitOfWork.execute((transaction) => {
        transaction.collect([anEvent('probe.happened')]);
        throw new Error('rejected');
      }),
    ).rejects.toThrow('rejected');

    expect(unitOfWork.events.published).toHaveLength(0);
  });
});

describe('permission fakes', () => {
  it('grants exactly what is listed', async () => {
    const checker = permitting('leave.read');

    expect(await checker.holds('leave.read')).toBe(true);
    expect(await checker.holds('leave.approve')).toBe(false);
    expect(await denyAll.holds('leave.read')).toBe(false);
  });
});

describe('RecordingDispatcher', () => {
  it('records and still delivers', async () => {
    const dispatcher = new RecordingDispatcher();
    let delivered = 0;
    dispatcher.register({
      eventName: 'probe.happened',
      handle: () => {
        delivered += 1;
        return Promise.resolve();
      },
    });

    await dispatcher.dispatch([anEvent('probe.happened')]);

    expect(dispatcher.published).toHaveLength(1);
    expect(delivered).toBe(1);
  });
});

describe('inTestTenant', () => {
  it('provides a tenant context to work that needs one', () => {
    expect(inTestTenant(() => 'ran')).toBe('ran');
  });
});
