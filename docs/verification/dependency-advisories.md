# Dependency advisories and how each was answered

`pnpm audit --audit-level high` is a CI gate. This file records what tripped it, what the remedy was,
and — where an override was used — the evidence that the forced version actually works, because an
override that silently breaks a toolchain is worse than the advisory it silences.

**The rule this file exists to enforce:** never add an override merely to make the audit green. Prefer,
in order: a lockfile refresh within the declared range · a package upgrade · an override **verified
against the tool that consumes it** · documenting the exposure and leaving the gate red.

---

## GHSA-2v37-7h3g-55p8 — `nanoid` — resolved without an override

**High.** `nanoid` before 3.3.18 can loop indefinitely when a custom generator is given size zero.
Reached the tree through `apps/admin > @tailwindcss/postcss > postcss > nanoid`.

**Remedy: a lockfile refresh, nothing more.** `postcss@8.5.25` declares `nanoid ^3.3.16`, and the
patched `3.3.18` satisfies that range — so the fix was to take the patched transitive dependency in
place. No manifest changed, `postcss` stayed at 8.5.25, and Tailwind was untouched. Merged in #13
(`7c29a92`).

## GHSA-ggr8-5vv4-36mx — `deepmerge-ts` — override, verified

**High.** DeepmergeTS has stack exhaustion when merging recursive object graphs. Vulnerable `<8.0.0`,
patched `>=8.0.0`. Reached the tree through exactly one path:

```
apps__api > prisma > @prisma/config > deepmerge-ts
```

**Why the nanoid remedy could not be reused.** `@prisma/config` does not declare a range — it pins
`deepmerge-ts: "7.1.5"` **exactly**, so there is no patched version inside the range to refresh to.

**Why upgrading Prisma does not help either.** Checked rather than assumed: `@prisma/config@7.9.1` —
the latest at the time of writing, and a *major* version ahead of the repository's `6.19.3` — pins the
**same** `deepmerge-ts: 7.1.5`. So no Prisma version fixes this, and a major Prisma upgrade would have
been a large architectural change that did not even address the finding.

That leaves an override as the only mechanism. It was added **and then tested**, not added and assumed:

```jsonc
"pnpm": { "overrides": { "deepmerge-ts": "^8.0.2" } }
```

**Evidence the forced version works.** `@prisma/config` is what the Prisma CLI uses to read
configuration, so the test is the CLI itself:

| Check | Result with `deepmerge-ts@8.0.2` |
|---|---|
| `pnpm audit --audit-level high` | **No known vulnerabilities found** |
| `prisma validate` | **PASS** — schema valid |
| `prisma migrate status` | **PASS** — 25 migrations, up to date, no drift |
| `turbo run build lint typecheck test --force --concurrency=1` | **PASS** — see the commit that added this entry |

`prisma generate` cannot be exercised in the development sandbox: the CLI tries to
`pnpm add prisma@6.19.3 -D` against the registry, which the sandbox blocks. **This was proved
pre-existing rather than assumed** — stashing the override, reinstalling from the unmodified lockfile
and re-running produced the identical failure, and the error names a registry write rather than
anything to do with merging. CI runs `prisma generate` on an unrestricted network.

**Exposure, stated plainly.** `prisma` is a **devDependency** of `apps/api`; `@prisma/config` is not in
the production runtime graph, and the vulnerable code merges *configuration files the repository
itself owns*, not user input. The finding was a build-toolchain exposure rather than a reachable
runtime one — which is the reason the override was allowed to be the answer, and **not** a reason it
could have been skipped: a high advisory on a CI gate is fixed or explained, never ignored.

**Not caused by the change it blocked.** The advisory was published after #13 merged, and the branch
carrying it changed no dependency file — `git diff origin/main...HEAD -- package.json pnpm-lock.yaml
'**/package.json'` was empty. `main` carried the same exposure at the same moment.
