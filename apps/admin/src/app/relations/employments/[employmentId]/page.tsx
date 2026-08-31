import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { Page, PageHeader } from '@munaxa/ui';

import { loadEmploymentRelations } from '../../../../relations/api';
import {
  directionOf,
  isLanguage,
  personNamed,
  relationsTranslator,
  type Language,
} from '../../../../relations/locale';
import { Boundaries, Isolated } from '../../../../relations/frame';
import { ViolationsSection } from '../../../../relations/employment-relations';

/**
 * One employment's relations record — the only listing Relations has, and it names its subject.
 *
 * This route consumes `GET /relations/violations?employmentId=` — employment-scoped by the
 * module's design, because the only collection read of violations takes an employment. There is no
 * tenant-wide register behind this page, none is assembled here, and the way in is the employee
 * record: this screen is the "everything, with totals" behind the record's ten-row summary.
 *
 * **The employment itself is asked so the page can name who it is about** — and its refusal is
 * survivable by design. AD-007 restricts relations access independently of ordinary employee
 * access, so a caller with `relations.violation.read` and no `employment.read` is legitimate: they
 * get the case list under the identifier they arrived with rather than a name. Only a 404 — no
 * such employment in this tenant — is a not-found page.
 *
 * Like the detail routes before it, this one renders the correct not-found state at HTTP 200: the
 * shell streams before the page's `await` resolves, so the status is already committed when
 * `notFound()` runs. That is shared infrastructure and a separately tracked issue; this slice
 * inherits it rather than changing it for a dozen routes at once.
 */

export const metadata: Metadata = { title: 'Employee relations' };

interface PageProps {
  readonly params: Promise<{ readonly employmentId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/**
 * The two statements a reader of this screen is most likely to assume otherwise about: that a
 * record here can be edited away, and that the types carry legal weight.
 */
const BOUNDARIES = ['relations.notice.immutable', 'relations.notice.noLegalCheck'];

const EmploymentRelationsPage = async ({ params, searchParams }: PageProps): Promise<ReactNode> => {
  const { employmentId } = await params;
  const requested = single((await searchParams)['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const t = relationsTranslator(language);
  const relations = await loadEmploymentRelations(employmentId);

  if (relations.employment.kind === 'missing') notFound();

  const employment = relations.employment.kind === 'ok' ? relations.employment.value : undefined;
  const name = personNamed(employment?.personName, language);

  return (
    <div dir={directionOf(language)} lang={language}>
      <Page width="wide">
        <PageHeader
          above={
            <a
              href={`/employment/${employmentId}?lang=${language}`}
              className="text-xs text-muted-foreground underline underline-offset-4"
            >
              {t('relations.label.backToRecord')}
            </a>
          }
          title={<Isolated>{name ?? employmentId}</Isolated>}
          description={
            <>
              {t('relations.label.register')}
              {employment === undefined ? null : (
                <>
                  {' · '}
                  <Isolated>{employment.employmentNumber}</Isolated>
                </>
              )}
            </>
          }
        />

        <ViolationsSection
          t={t}
          language={language}
          violations={relations.violations}
          categories={relations.categories}
        />

        <Boundaries t={t} keys={BOUNDARIES} />
      </Page>
    </div>
  );
};

export default EmploymentRelationsPage;
