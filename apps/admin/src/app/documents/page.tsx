import type { ReactNode } from 'react';

import { loadDocuments } from '../../documents/api';
import { directionOf, isLanguage, translator, type Language } from '../../documents/locale';
import {
  AuditSection,
  ExpiringSection,
  FindingsSection,
  RegisterSection,
  TypesSection,
  VerificationQueueSection,
  VersionsSection,
} from '../../documents/sections';

/**
 * The employee documents screen.
 *
 * Presentation only: it consumes the module's published contracts through the API and holds no
 * business logic of its own — no rule about who may see a confidential document, no expiry derived
 * a second time, no verification decided here. Those live in the domain and the application
 * service, and a screen that reimplemented them would be a second, weaker answer to a question the
 * API already decided. **It reaches no repository and no database.**
 *
 * **`?lang=ar`** switches language *and* direction together. Direction follows language and is never
 * a separate control — separating them is how a page ends up left-aligned in Arabic.
 *
 * **No file ever reaches this page.** There is no upload control and no download button, because no
 * storage adapter exists in this repository. The register says what a document *is*; obtaining the
 * bytes is a separate authorized, audited operation, and today it answers that the capability is
 * unavailable.
 */
export default async function DocumentsPage({
  searchParams,
}: {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const parameters = (await searchParams) ?? {};
  const requested = parameters['lang'];
  const language: Language = isLanguage(typeof requested === 'string' ? requested : undefined)
    ? (requested as Language)
    : 'en';
  const t = translator(language);
  const documents = await loadDocuments();
  const props = { t, language };

  return (
    <main dir={directionOf(language)} className="flex flex-col gap-6 p-8">
      <h1 className="text-2xl font-medium">{t('documents.label.documents')}</h1>

      <TypesSection {...props} types={documents.types} />
      <RegisterSection
        {...props}
        documents={documents.documents}
        total={documents.total}
        unavailable={documents.unavailable}
      />
      <ExpiringSection {...props} expiring={documents.expiring} />
      <VerificationQueueSection {...props} awaiting={documents.awaitingVerification} />
      <VersionsSection
        {...props}
        versions={documents.versions}
        verifications={documents.verifications}
      />
      <AuditSection {...props} trail={documents.trail} withheld={documents.trailWithheld} />
      <FindingsSection {...props} findings={documents.findings} />
    </main>
  );
}
