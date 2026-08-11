import { describe, expect, it } from 'vitest';

import { ADMINISTRATOR, ask, harnessFor, tryAsk } from './documents-test-harness.js';
import { createDocumentFor, defineType } from './documents-scenarios.js';
import { DocumentsPermissions } from './documents-permissions.js';
import type { DocumentView } from '../contracts/views.js';
import type { Page } from './documents-ports.js';

/**
 * Searching, and the confidentiality rule that binds it.
 *
 * The rule is applied **in** the query rather than after it, exactly as the SQL does: a caller
 * without `document.read-sensitive` does not receive confidential documents and does not learn how
 * many were withheld, because a count is itself a disclosure.
 */

describe('searching', () => {
  it('withholds confidential documents from a caller without read-sensitive', async () => {
    // Everything except `document.read-sensitive`, so the setup can file the document and the
    // search still cannot see it.
    const harness = harnessFor({
      permissions: [
        DocumentsPermissions.read,
        DocumentsPermissions.manage,
        DocumentsPermissions.typeManage,
      ],
    });
    const confidential = await defineType(harness, {
      code: 'medical-certificate',
      confidentiality: 'confidential',
      requiresVerification: false,
    });

    await createDocumentFor(harness, { documentTypeId: confidential });

    const found = await harness.as(ADMINISTRATOR, () =>
      ask<Page<DocumentView>>(harness, { queryName: 'documents.search' }),
    );

    // Not a short page and not a count: the row never leaves the store, because "this employee has
    // one document you may not see" is itself the disclosure.
    expect(found.items).toHaveLength(0);
    expect(found.total).toBe(0);
  });

  it('reports a confidential document as not found rather than forbidden', async () => {
    const permitted = harnessFor();
    const confidential = await defineType(permitted, {
      code: 'medical-certificate',
      confidentiality: 'confidential',
      requiresVerification: false,
    });
    const { documentId } = await createDocumentFor(permitted, {
      documentTypeId: confidential,
    });

    const restricted = harnessFor({ permissions: [DocumentsPermissions.read] });
    const refused = await restricted.as(ADMINISTRATOR, () =>
      tryAsk(restricted, { queryName: 'documents.read-document', documentId }),
    );

    expect(refused.ok).toBe(false);
    expect(refused.ok ? undefined : refused.error).toMatchObject({ kind: 'not_found' });
  });

  it('bounds every page', async () => {
    const harness = harnessFor();
    const documentTypeId = await defineType(harness, { requiresVerification: false });

    for (let index = 0; index < 3; index += 1) {
      await createDocumentFor(harness, { documentTypeId });
    }

    const found = await harness.as(ADMINISTRATOR, () =>
      ask<Page<DocumentView>>(harness, { queryName: 'documents.search', size: 2 }),
    );

    expect(found.items).toHaveLength(2);
    expect(found.total).toBe(3);
  });

  it('finds documents expiring on or before a date', async () => {
    const harness = harnessFor();
    const documentTypeId = await defineType(harness, { requiresVerification: false });

    await createDocumentFor(harness, { documentTypeId, expiryDate: '2026-09-01' });
    await createDocumentFor(harness, { documentTypeId, expiryDate: '2030-09-01' });

    const found = await harness.as(ADMINISTRATOR, () =>
      ask<Page<DocumentView>>(harness, {
        queryName: 'documents.search',
        expiringOnOrBefore: '2026-12-31',
      }),
    );

    expect(found.total).toBe(1);
    expect(found.items[0]?.expiryState).toBe('expiring_soon');
  });
});
