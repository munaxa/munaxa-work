import { describe, expect, it } from 'vitest';

import {
  ADMINISTRATOR,
  VERIFIER,
  ask,
  attempt,
  harnessFor,
  respondingStorage,
  send,
  tryAsk,
} from './documents-test-harness.js';
import { OTHER_HASH, addVersion, filedDocument } from './documents-scenarios.js';
import { DocumentsPermissions } from './documents-permissions.js';
import type { AccessEventView, ReconciliationFindingView } from '../contracts/views.js';
import type { DownloadAuthorization } from './verification.use-case.js';
import type { Page } from './documents-ports.js';

/**
 * The access trail, the download authorization, and what reconciliation reports.
 *
 * The property these suites are really about is that **nothing here fabricates a file**. The default
 * harness has no storage adapter — which is what production has — and the assertions say so: no URL,
 * `available: false`, and the attempt recorded as refused rather than swallowed.
 */

const auditOf = (
  harness: ReturnType<typeof harnessFor>,
  documentId: string,
): Promise<Page<AccessEventView>> =>
  harness.as(ADMINISTRATOR, () =>
    ask<Page<AccessEventView>>(harness, { queryName: 'documents.audit', documentId }),
  );

describe('the access trail', () => {
  it('records a metadata read, with the actor and the correlation reference', async () => {
    const harness = harnessFor();
    const { documentId } = await filedDocument(harness);

    await harness.as(VERIFIER, () =>
      ask(harness, { queryName: 'documents.read-document', documentId }),
    );

    const audit = await auditOf(harness, documentId);
    const read = audit.items.find((event) => event.action === 'metadata_read');

    expect(read?.actor).toBe(VERIFIER);
    expect(read?.correlationId).toBeDefined();
    expect(read?.outcome).toBe('permitted');
  });

  it('records replacing, verifying and archiving as distinct actions', async () => {
    const harness = harnessFor();
    const { documentId, documentVersionId } = await filedDocument(harness);

    await harness.as(VERIFIER, () =>
      send(harness, {
        commandName: 'documents.verify',
        documentId,
        documentVersionId,
        decision: 'verified',
      }),
    );
    await addVersion(harness, documentId, OTHER_HASH);
    await harness.as(ADMINISTRATOR, () =>
      send(harness, {
        commandName: 'documents.move-document',
        documentId,
        status: 'archived',
        expectedVersion: 4,
      }),
    );

    const audit = await auditOf(harness, documentId);
    const actions = audit.items.map((event) => event.action);

    expect(actions).toContain('replaced');
    expect(actions).toContain('verified');
    expect(actions).toContain('archived');
  });

  it('carries no content, no storage reference and no URL', async () => {
    const harness = harnessFor();
    const { documentId } = await filedDocument(harness);

    await harness.as(ADMINISTRATOR, () =>
      ask(harness, { queryName: 'documents.read-document', documentId }),
    );

    const audit = await auditOf(harness, documentId);

    for (const event of audit.items) {
      expect(Object.keys(event)).not.toContain('storageReference');
      expect(Object.keys(event)).not.toContain('url');
    }
  });

  it('is behind its own permission', async () => {
    const harness = harnessFor({
      permissions: [
        DocumentsPermissions.read,
        DocumentsPermissions.manage,
        DocumentsPermissions.typeManage,
      ],
    });
    const { documentId } = await filedDocument(harness);
    const refused = await harness.as(ADMINISTRATOR, () =>
      tryAsk(harness, { queryName: 'documents.audit', documentId }),
    );

    // Who has looked at an employee's file is itself a sensitive read; `document.read` is not it.
    expect(refused.ok).toBe(false);
  });
});

describe('authorizing a download', () => {
  it('reports the capability as unavailable rather than inventing a URL', async () => {
    const harness = harnessFor();
    const { documentId } = await filedDocument(harness);
    const authorization = await harness.as(ADMINISTRATOR, () =>
      send<DownloadAuthorization>(harness, {
        commandName: 'documents.authorize-download',
        documentId,
      }),
    );

    // No storage adapter exists in this repository. That is reported honestly, never as a link.
    expect(authorization.available).toBe(false);
    expect(authorization.url).toBeUndefined();
  });

  it('records the refused attempt', async () => {
    const harness = harnessFor();
    const { documentId } = await filedDocument(harness);

    await harness.as(VERIFIER, () =>
      send(harness, { commandName: 'documents.authorize-download', documentId }),
    );

    const audit = await auditOf(harness, documentId);
    const attemptRecorded = audit.items.find((event) => event.action === 'download_refused');

    // An attempt that could not be served is still an attempt somebody made.
    expect(attemptRecorded?.actor).toBe(VERIFIER);
    expect(attemptRecorded?.outcome).toBe('refused');
  });

  it('asks storage only after the access has been authorized', async () => {
    const storage = respondingStorage();
    const harness = harnessFor({ storage });
    const { documentId } = await filedDocument(harness);

    const refused = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'documents.authorize-download',
        documentId: '00000000-0000-7000-8000-000000000000',
      }),
    );

    expect(refused.ok).toBe(false);
    // A refused caller never causes a URL to exist.
    expect(storage.requested).toHaveLength(0);

    await harness.as(ADMINISTRATOR, () =>
      send(harness, { commandName: 'documents.authorize-download', documentId }),
    );

    expect(storage.requested).toHaveLength(1);
  });

  it('refuses a caller without the download permission, even one who may read', async () => {
    const harness = harnessFor({
      permissions: [
        DocumentsPermissions.read,
        DocumentsPermissions.manage,
        DocumentsPermissions.typeManage,
      ],
    });
    const { documentId } = await filedDocument(harness);
    const refused = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, { commandName: 'documents.authorize-download', documentId }),
    );

    expect(refused.ok).toBe(false);
  });

  it('refuses a document with no version at all', async () => {
    const harness = harnessFor();
    const { documentId } = await filedDocument(harness, { code: 'passport' });
    const other = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'documents.authorize-download',
        documentId,
        documentVersionId: '00000000-0000-7000-8000-000000000000',
      }),
    );

    expect(other.ok).toBe(false);
  });
});

describe('reconciliation', () => {
  it('reports duplicate content and repairs nothing', async () => {
    const harness = harnessFor();
    const first = await filedDocument(harness, { code: 'passport' });
    const second = await filedDocument(harness, { code: 'contract' });

    const findings = await harness.as(ADMINISTRATOR, () =>
      ask<{ readonly findings: readonly ReconciliationFindingView[] }>(harness, {
        queryName: 'documents.reconciliation',
      }),
    );
    const duplicates = findings.findings.filter((one) => one.finding === 'duplicate_content');

    expect(duplicates.map((one) => one.documentId).sort()).toEqual(
      [first.documentId, second.documentId].sort(),
    );

    // Nothing was deleted or rewritten: both documents are still readable afterwards.
    for (const documentId of [first.documentId, second.documentId]) {
      const still = await harness.as(ADMINISTRATOR, () =>
        tryAsk(harness, { queryName: 'documents.read-document', documentId }),
      );

      expect(still.ok).toBe(true);
    }
  });

  it('reports a verification that no longer covers the current version', async () => {
    const harness = harnessFor();
    const { documentId, documentVersionId } = await filedDocument(harness);

    await harness.as(VERIFIER, () =>
      send(harness, {
        commandName: 'documents.verify',
        documentId,
        documentVersionId,
        decision: 'verified',
      }),
    );

    const before = await harness.as(ADMINISTRATOR, () =>
      ask<{ readonly findings: readonly ReconciliationFindingView[] }>(harness, {
        queryName: 'documents.reconciliation',
      }),
    );

    expect(before.findings.some((one) => one.finding === 'stale_verification')).toBe(false);
  });
});
