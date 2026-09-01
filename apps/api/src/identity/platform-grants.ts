/**
 * Turning what Platform granted into what Work understands (ADR-0076).
 *
 * Platform's permission grammar is `resource:action` and Work's is dot-separated, and neither can
 * express the other: Platform's segments forbid a dot, so all 285 of Work's names are rejected by
 * its validators. The contract that resolves it keeps each product's vocabulary where it belongs —
 * Work names a permission, Platform carries the grant — and this file is the whole of the
 * translation.
 *
 * Four rules, applied in this order, and each one drops rather than repairs:
 *
 * 1. **Namespace.** Only `work:` is this product's. Another product's grant is not a Work
 *    permission that failed to parse; it is somebody else's authority, and it is discarded.
 * 2. **No pattern.** A grant containing `*` grants nothing here — not the permissions it would
 *    cover, not the module it names, nothing. There is no expansion and no prefix match, because
 *    Work's whole authorization model is that a grant names exactly what it confers.
 * 3. **Mapping.** `ψ` is the exact inverse of `φ`, proven over all 285.
 * 4. **Catalogue.** The result must be a permission Work actually declares. Work owns the
 *    vocabulary, so a grant naming something Work never declared cannot bring it into existence.
 *
 * Rule 2 is worth noticing for what it is *not*: a filter that would be unsafe to forget. Because
 * rule 4 tests membership of a closed set, `ψ("work:*")` is `work.*`, which is in no catalogue and
 * matches nothing. The wildcard is refused by construction; rule 2 exists so that the refusal is
 * *reported* rather than merely happening, since an operator whose grant did nothing deserves to
 * find out from a log.
 */

/** The namespace reserved for Munaxa Work in Platform's grant space (ADR-0076). */
export const WORK_GRANT_NAMESPACE = 'work:';

/**
 * Platform's own grant grammar, for what follows the namespace: colon-separated segments of
 * `[a-z0-9][a-z0-9_-]*`. Held here rather than imported because `@munaxa/rbac` validates it in a
 * form Work must not use — its `assertValidCheck` throws on every one of Work's 285 names.
 */
const PLATFORM_SEGMENTS = /^[a-z0-9][a-z0-9_-]*(?::[a-z0-9][a-z0-9_-]*)*$/;

/** Why a grant conferred nothing. Reported, never guessed at. */
export type DroppedGrantReason =
  'not-a-work-grant' | 'wildcard' | 'malformed' | 'not-a-declared-permission';

export interface DroppedGrant {
  readonly grant: string;
  readonly reason: DroppedGrantReason;
}

/**
 * A Work permission, as Platform records it.
 *
 * Exported because the permission catalogue artifact is generated through it, and because the
 * mapping tests assert `ψ(φ(p)) = p` over every declared permission rather than over examples.
 */
export const platformGrantFor = (workPermission: string): string =>
  `${WORK_GRANT_NAMESPACE}${workPermission.replaceAll('.', ':')}`;

/**
 * The Work permission a Platform grant names, or why it names none.
 *
 * Deliberately total and side-effect free: it decides, and `workGrantsFrom` acts. Nothing here
 * consults the catalogue, so this function answers "is this a Work permission name" and the caller
 * answers "is it one we declare" — two questions that are easier to test apart than together.
 */
export const workPermissionFrom = (
  grant: unknown,
): { readonly permission: string } | { readonly reason: DroppedGrantReason } => {
  if (typeof grant !== 'string' || grant.trim() === '') return { reason: 'malformed' };

  const value = grant.trim();

  // Before the namespace test, so that `work:*` is reported as the wildcard it is rather than as a
  // Work grant that happened not to exist.
  if (value.includes('*')) return { reason: 'wildcard' };
  if (!value.startsWith(WORK_GRANT_NAMESPACE)) return { reason: 'not-a-work-grant' };

  const remainder = value.slice(WORK_GRANT_NAMESPACE.length);

  // The remainder must be Platform's grammar and only Platform's. Without this, `work:leave.read`
  // would map to `leave.read` — a Work name that arrived in Work's own spelling — and two
  // spellings of one grant would both be authoritative. Platform records `work:leave:read`; that
  // is the contract, and a grant written any other way names nothing.
  if (!PLATFORM_SEGMENTS.test(remainder)) return { reason: 'malformed' };

  return { permission: remainder.replaceAll(':', '.') };
};

/**
 * The exact Work permissions a verified `perms` claim confers.
 *
 * `perms` arrives as `unknown` on purpose. It is a claim from a token: cryptographically vouched
 * for, and still a value whose shape this product must not assume. Absent, not an array, or full of
 * things that are not strings, the answer is the same and it is the safe one — an empty set, and a
 * caller who holds nothing.
 *
 * The returned set is what `PlatformPermissionChecker` asks with `Set.has`. It contains only names
 * drawn from `catalogue`, so there is no path by which a token widens Work's vocabulary.
 */
export const workGrantsFrom = (
  perms: unknown,
  catalogue: ReadonlySet<string>,
  onDropped?: (dropped: DroppedGrant) => void,
): ReadonlySet<string> => {
  if (!Array.isArray(perms)) return new Set();

  const granted = new Set<string>();

  for (const entry of perms) {
    const read = workPermissionFrom(entry);

    if (!('permission' in read)) {
      report(onDropped, entry, read.reason);
      continue;
    }
    if (!catalogue.has(read.permission)) {
      report(onDropped, entry, 'not-a-declared-permission');
      continue;
    }
    granted.add(read.permission);
  }
  return granted;
};

/**
 * Names the grant that conferred nothing, and nothing else.
 *
 * A grant name is not a credential — it is the same string an administrator typed into a role — so
 * reporting it is what makes the diagnostic useful. The token it arrived in is never in scope here,
 * and there is deliberately no parameter through which it could be.
 */
const report = (
  onDropped: ((dropped: DroppedGrant) => void) | undefined,
  entry: unknown,
  reason: DroppedGrantReason,
): void => {
  onDropped?.({ grant: typeof entry === 'string' ? entry : '<not a string>', reason });
};
