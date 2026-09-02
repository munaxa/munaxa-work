# Munaxa Work — the admin web application.
#
# Multi-stage so the runtime image carries no compiler, no source and no dev dependency: the
# smaller the image, the smaller the set of things that can be exploited inside it.
#
# The GitHub Packages credential arrives as a build secret rather than a build argument. An ARG is
# recorded in the image history, so a token passed that way is readable by anybody who can pull the
# image — which for a private registry is a wider set than the people who were given the token.
#
# Build from the repository root, not from this directory:
#   docker build -f apps/admin/Dockerfile -t munaxa-work-admin:<git-sha> .

FROM node:22-alpine AS build
WORKDIR /app

# An optional trust anchor for build environments whose egress proxy re-terminates TLS — most
# corporate networks. Without it the failure is `SELF_SIGNED_CERT_IN_CHAIN` from every registry
# fetch, which reads like a broken network rather than a missing certificate.
#
# A secret mount rather than a COPY: the certificate is not sensitive, but mounting it keeps it out
# of the image layers, and a build that does not supply one is unaffected. Nothing here disables
# verification — the CA is *appended* to the trust bundle, which is the difference between trusting
# one more issuer and trusting everybody.
#
# Appended directly rather than through `update-ca-certificates`, which alpine does not ship:
# installing it would need the network this certificate exists to unblock. Node is handled
# separately via NODE_EXTRA_CA_CERTS because it carries its own CA store and ignores the system one.
RUN --mount=type=secret,id=ca_bundle \
    if [ -s /run/secrets/ca_bundle ]; then \
      cat /run/secrets/ca_bundle >> /etc/ssl/certs/ca-certificates.crt; \
      cp /run/secrets/ca_bundle /etc/ssl/certs/build-proxy.pem; \
    fi && \
    NODE_EXTRA_CA_CERTS="$([ -f /etc/ssl/certs/build-proxy.pem ] && echo /etc/ssl/certs/build-proxy.pem || true)" \
    corepack enable && \
    NODE_EXTRA_CA_CERTS="$([ -f /etc/ssl/certs/build-proxy.pem ] && echo /etc/ssl/certs/build-proxy.pem || true)" \
    corepack prepare pnpm@10.33.0 --activate

COPY . .

# `always-auth` is not optional and its absence is not obvious. GitHub Packages answers a tarball
# request with a 302 to a CDN, and without this pnpm drops the credential on the redirect — so
# metadata resolves, `npm view` works, and only the download fails, with a bare ERR_PNPM_FETCH_401
# that looks like a bad token rather than a dropped header.
#
# The credential is written and removed inside one RUN, so it is absent from the committed layer.
RUN --mount=type=secret,id=npm_token --mount=type=secret,id=ca_bundle \
    NODE_EXTRA_CA_CERTS="$([ -f /etc/ssl/certs/build-proxy.pem ] && echo /etc/ssl/certs/build-proxy.pem || true)" \
    sh -c 'set -e; \
      T="$(cat /run/secrets/npm_token)"; \
      printf "//npm.pkg.github.com/:_authToken=%s\n//npm.pkg.github.com/:always-auth=true\n" "$T" > /root/.npmrc; \
      pnpm install --frozen-lockfile; \
      rm -f /root/.npmrc'

# The admin build needs no Prisma client: it talks to the API over HTTP and owns no database
# connection. That is the boundary, not an oversight — a browser-facing app with database
# credentials is a different and much worse thing than a browser-facing app without them.
RUN pnpm turbo run build --filter @work/admin

# Dev dependencies are removed with a production install rather than with `pnpm prune --prod` or
# `pnpm deploy`, both of which were tried first and both of which are wrong here.
#
# `pnpm deploy` deadlocks on pnpm 10.33: `--legacy` (which v10 demands for a non-injected workspace)
# enters the copy from the content-addressable store and then waits forever on nothing. A build that
# never returns is worse than one that fails, because CI has no failure to report.
#
# `pnpm prune --prod` returns promptly and looks correct — it reports the root devDependencies it
# removed and nothing else — but it also empties every *workspace project's* node_modules and does
# not put them back. The image builds, starts, and dies on the first `require` of a dependency,
# which is the worst possible place to find out. `pnpm install --prod` re-links every project in the
# workspace with production dependencies only, which is what was wanted all along.
#
# CI=true is required, not cosmetic: the install rebuilds the modules directory and without a TTY to
# confirm that it refuses with ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY.
#
# `rm -rf node_modules` before the install, and that is the part that matters. `pnpm install --prod`
# re-links each project's node_modules but does not garbage-collect the virtual store underneath, so
# vitest, eslint, turbo and the Nest CLI all survived into the shipped image — the manifest said
# production and the filesystem said otherwise. Removing the tree first makes the prod install
# materialise only what production actually resolves. Packages come from the build stage's
# content-addressable store, so this costs seconds, not a re-download.
RUN --mount=type=secret,id=npm_token --mount=type=secret,id=ca_bundle \
    NODE_EXTRA_CA_CERTS="$([ -f /etc/ssl/certs/build-proxy.pem ] && echo /etc/ssl/certs/build-proxy.pem || true)" \
    CI=true \
    sh -c 'set -e; \
      T="$(cat /run/secrets/npm_token)"; \
      printf "//npm.pkg.github.com/:_authToken=%s\n//npm.pkg.github.com/:always-auth=true\n" "$T" > /root/.npmrc; \
      rm -rf node_modules apps/*/node_modules packages/*/node_modules packages/modules/*/node_modules; \
      pnpm install --prod --frozen-lockfile; \
      rm -f /root/.npmrc'

# TypeScript sources are dropped once they have been compiled. They are not secret, but an image is
# distributed more widely than a repository is, and nothing in a running service reads them.
RUN find /app/packages -type d \( -name src -o -name test -o -name __tests__ \) -prune -exec rm -rf {} + && \
    find /app -name '*.tsbuildinfo' -delete && \
    rm -f /app/.npmrc

FROM node:22-alpine AS runtime
ENV NODE_ENV=production

# Never root. A container that is compromised should not also be privileged inside itself.
RUN addgroup -S admin && adduser -S -G admin admin

# The workspace is copied whole, at the paths the build used. pnpm's node_modules is a tree of
# relative symlinks into node_modules/.pnpm; move a package and every link inside it dangles. With
# twenty workspace packages an explicit per-package copy list is a maintenance trap that fails at
# runtime rather than at build time, so the shape is preserved instead.
COPY --from=build --chown=admin:admin /app /app

WORKDIR /app/apps/admin
USER admin
EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

# `next start`, not `node server.js`: this app is not built in standalone output mode, so Next's own
# launcher is what knows how to serve the .next directory it produced.
CMD ["node_modules/.bin/next", "start", "--port", "3001"]
