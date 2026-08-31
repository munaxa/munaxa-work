import { assertValidCheck } from '@munaxa/rbac';

/**
 * The one place Munaxa Work's permission vocabulary meets the platform's.
 *
 * Work declares `employment.employment.read`; the platform's grammar is `resource:action`,
 * optionally scoped, with `.` outside its character class. Both are right for their own side —
 * 285 declarations across eighteen modules are the product's authorization vocabulary and appear
 * in module registries, tests and administration screens, while the colon grammar is what the
 * resolver's wildcard and scope matching is defined on — so the two are reconciled here rather
 * than one of them being rewritten.
 *
 * **One function, and nothing else in the repository translates.** A `replace('.', ':')` written
 * at a second call site is a second vocabulary that drifts from this one; the lint budget will
 * not catch it and no test would fail. Everything that needs a platform check string calls this.
 *
 * **It is total, and it is injective.** Every one of the 285 declarations is a dot-separated run
 * of segments that already match the platform's `[a-z0-9][a-z0-9_-]*`, so the mapping is a pure
 * separator substitution: nothing is renamed, nothing is dropped, and no two Work permissions
 * become one platform check. `permission-vocabulary.spec.ts` asserts all three properties over
 * the real declarations rather than over examples.
 *
 * **It fails closed.** A permission that cannot be represented returns `undefined`, the checker
 * refuses, and the handler behind it is unreachable. The alternative — passing the string through
 * unchanged and hoping — would hand the resolver something it cannot match, which denies too,
 * but silently and for the wrong reason.
 */
export const toPlatformPermission = (permission: string): string | undefined => {
  // A Work permission carrying a colon or a wildcard is not a Work permission this seam can
  // reason about: the first would translate ambiguously and the second is a *grant* shape that
  // must never appear in a check. Neither exists today, and neither is quietly accepted.
  if (permission.includes(':') || permission.includes('*')) return undefined;

  const candidate = permission.replaceAll('.', ':');

  try {
    assertValidCheck(candidate);
    return candidate;
  } catch {
    return undefined;
  }
};
