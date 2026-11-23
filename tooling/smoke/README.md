# Work smoke test (MW-006)

`work-smoke.mjs` checks a deployed Munaxa Work in under a minute: the API is ready, it refuses
anonymous and cross-tenant requests, a persona can read, a persona without a grant is refused, the
licence admits the read, the admin renders for a signed-in user, and Identity logout revokes the
token within the revocation cache window. It needs Node 22 and nothing else: no `pnpm install`, no
AWS credentials, no database access.

It exits `0` when every probe passed, `1` when any probe failed and `2` when an input is missing.
It never prints a password, a token or a cookie value: every line goes through `redact.mjs`, which
removes the supplied secrets, the session tokens it receives and anything shaped like a JWT, a
bearer value or a session cookie. `work-smoke.test.mjs` asserts that.

## Probes

| Probe               | Request                                                                                  | Passes when                                                     |
| ------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `health-ready`      | `GET $WORK_HEALTH_URL`                                                                   | 200 with the API's body `{"status":"ok"}`                       |
| `unauthenticated`   | `GET $SMOKE_READ_PATH`, no credential                                                    | 401                                                             |
| `persona-read`      | `GET $SMOKE_READ_PATH` as the reader                                                     | 200                                                             |
| `forbidden`         | `$SMOKE_FORBIDDEN_METHOD $SMOKE_FORBIDDEN_PATH` as the limited persona                   | 403                                                             |
| `entitlements`      | `GET $SMOKE_READ_PATH` as the reader                                                     | 200; a 402 (licence refusal) fails and prints only its `reason` |
| `admin-signed-in`   | admin `$SMOKE_ADMIN_PATH` and `$SMOKE_ADMIN_DATA_PATH` with the reader's session cookie | 200, signed-in content, neither "signed out" nor "no workspace" |
| `cross-tenant`      | `GET $SMOKE_READ_PATH` as the reader with `X-Munaxa-Tenant: $SMOKE_OTHER_TENANT_ID`      | 401, 403 or 404; any 2xx fails                                  |
| `logout-revocation` | Identity `POST /api/auth/logout`, then the read again, polled                            | 401 within `SMOKE_REVOCATION_WAIT_SECONDS`                      |

The logout probe runs last and spends the reader's session. With a token file, that token is
revoked by the run; sign in again for the next one.

## Inputs

| Variable                                                          | Required | Default                                                   |
| ----------------------------------------------------------------- | -------- | --------------------------------------------------------- |
| `WORK_BASE_URL`                                                   | yes      | e.g. `https://work.<testing domain>`                      |
| `SMOKE_OTHER_TENANT_ID`                                           | yes      | a Work tenant id the reader is **not** a member of        |
| `SMOKE_READER_IDENTIFIER` + `SMOKE_READER_PASSWORD`, or `SMOKE_READER_TOKEN_FILE`    | yes | the persona that reads (`work-testing-org-admin`) |
| `SMOKE_LIMITED_IDENTIFIER` + `SMOKE_LIMITED_PASSWORD`, or `SMOKE_LIMITED_TOKEN_FILE` | yes | a persona without the forbidden grant (`work-testing-employee`) |
| `SMOKE_TENANT_ID`                                                 | no       | unset: the persona's only membership                      |
| `WORK_API_BASE_URL`                                               | no       | `WORK_BASE_URL` (the ALB routes `/api/v1/*` to the API)   |
| `ADMIN_BASE_URL`                                                  | no       | `WORK_BASE_URL`                                           |
| `IDENTITY_BASE_URL`                                               | no       | `WORK_BASE_URL` (the ALB routes `/api/auth/*` to Identity) |
| `IDENTITY_ORIGIN`                                                 | no       | origin of `IDENTITY_BASE_URL`; must be a trusted origin   |
| `IDENTITY_ORGANISATION`                                           | no       | Identity's default organisation                           |
| `WORK_HEALTH_URL`                                                 | no       | `$WORK_API_BASE_URL/health/ready`; `skip` reports SKIP    |
| `SMOKE_READ_PATH`                                                 | no       | `/api/v1/organization/unit-types`                         |
| `SMOKE_FORBIDDEN_METHOD`, `SMOKE_FORBIDDEN_PATH`                  | no       | `GET`, `/api/v1/payroll/groups`                           |
| `SMOKE_ADMIN_PATH`, `SMOKE_ADMIN_DATA_PATH`                       | no       | `/?lang=en`, `/organization?lang=en`                      |
| `SMOKE_ADMIN_SIGNED_IN_TEXT`                                      | no       | `Enterprise HR administration` (the English home lead)    |
| `SMOKE_REVOCATION_WAIT_SECONDS`                                   | no       | `10` (the API's `PLATFORM_AUTH_REVOCATION_CACHE_MS` is 5 s by default) |
| `SMOKE_POLL_INTERVAL_MS`, `SMOKE_TIMEOUT_MS`                      | no       | `1000`, `10000`                                           |

A token file holds one access token (the value of the `__Host-mx_session` cookie) and nothing else.
Keep it outside the repository, readable only by you (`chmod 600`), and delete it after the run.

## In a Testing session

The persona accounts are the Testing personas seeded in Identity (MW-003). Read the passwords
into the shell without echoing them, so they reach neither the terminal history nor the log:

```sh
export WORK_BASE_URL='https://work.<testing domain>'
export SMOKE_OTHER_TENANT_ID='<a second Work tenant id>'
export SMOKE_READER_IDENTIFIER='<org admin persona email>'
export SMOKE_LIMITED_IDENTIFIER='<employee persona email>'
read -rs SMOKE_READER_PASSWORD && export SMOKE_READER_PASSWORD
read -rs SMOKE_LIMITED_PASSWORD && export SMOKE_LIMITED_PASSWORD

node tooling/smoke/work-smoke.mjs | tee work-smoke.log
unset SMOKE_READER_PASSWORD SMOKE_LIMITED_PASSWORD
```

The log is safe to attach to the Testing session record. Expected output on a healthy stack:

```text
PASS health-ready: 200 (35 ms)
PASS unauthenticated: 401 (40 ms)
PASS persona-read: 200 (210 ms)
PASS forbidden: 403 (180 ms)
PASS entitlements: 200 (60 ms)
PASS admin-signed-in: 200 signed in (420 ms)
PASS cross-tenant: 401 (55 ms)
PASS logout-revocation: 401 after 3100 ms (3300 ms)
OK: 8 passed, 0 failed, 0 skipped
```

**Readiness in Testing.** The Testing ALB sends only `/api/auth/*` and `/api/v1/*` on the Work
host to Identity and the API; `/health/ready` there reaches the admin, which does not answer with
the API's readiness body, so the probe fails rather than passing on the wrong service. Point
`WORK_HEALTH_URL` at an address that reaches the API task directly, or set it to `skip` and rely
on the ALB target health for that run; a skip is printed and counted.

**A persona that signs in with MFA** cannot be used with a password: Identity answers
`AUTH_MFA_REQUIRED`. Use a token file for it, taken from the browser's `__Host-mx_session` cookie
after signing in.

## Tests

```sh
node --test tooling/smoke/*.test.mjs
```

They start a fake Work host (`fake-work.fixture.mjs`, `node:http`) that serves Identity's
`/api/auth`, the API and the admin, run every probe against it healthy and then once per broken
behaviour, and run the command as a child process to check its exit codes and that neither stdout
nor stderr contains a supplied password, a token or a cookie value.
