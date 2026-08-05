import { describe, expect, it } from 'vitest';

import { uuidV7 } from '../identity/uuid-v7.js';

import { AutoApprovingPort, RecordingNotificationPort } from './in-process-ports.js';

describe('AutoApprovingPort', () => {
  const request = {
    subjectType: 'leave.request',
    subjectId: uuidV7(),
    requestedBy: 'user:a',
    context: {},
    correlationId: uuidV7(),
  };

  it('approves and says plainly that no workflow considered it', async () => {
    const status = await new AutoApprovingPort().request(request);

    expect(status.state).toBe('approved');
    expect(status.steps[0]?.approver).toBe('system:auto-approval');
    expect(status.steps[0]?.comment).toContain('No workflow is configured');
  });

  it('remembers the approval so status can be asked for later', async () => {
    const port = new AutoApprovingPort();
    const created = await port.request(request);

    expect((await port.status(created.approvalId)).approvalId).toBe(created.approvalId);
  });

  it('cancels an approval and records the reason', async () => {
    const port = new AutoApprovingPort();
    const created = await port.request(request);
    await port.cancel(created.approvalId, 'request withdrawn');

    const status = await port.status(created.approvalId);
    expect(status.state).toBe('cancelled');
    expect(status.steps.at(-1)?.comment).toBe('request withdrawn');
  });
});

describe('RecordingNotificationPort', () => {
  const request = {
    templateKey: 'leave.approved',
    recipients: [{ userId: uuidV7() }],
    variables: { days: 1 },
    correlationId: uuidV7(),
  };

  it('records what a domain asked to send', async () => {
    const port = new RecordingNotificationPort();
    await port.notify(request);

    expect(port.sent).toHaveLength(1);
  });

  it('suppresses a repeat carrying the same idempotency key', async () => {
    const port = new RecordingNotificationPort();
    await port.notify({ ...request, idempotencyKey: 'leave-1-approved' });
    await port.notify({ ...request, idempotencyKey: 'leave-1-approved' });

    expect(port.sent).toHaveLength(1);
  });
});
