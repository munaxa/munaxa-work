# Administrator guide

How to operate Munaxa Work: who can do what, how people get in, and what to check when something
looks wrong.

---

## Getting somebody into the product

There are two routes, and which one applies depends on whether the person already has a Munaxa
Platform account.

**They do not, or you do not know.** Invite them by email address.

```
POST /api/v1/identity/invitations
{ "email": "sara.haddad@example.com", "portals": ["employee", "manager"] }
```

They receive a link, sign into Platform (creating an account there if they need to), and accept.
Munaxa Work learns who they are from the account Platform vouched for — never from the link. An
invitation that reaches the wrong person is therefore worth very little: whoever follows it still
has to be somebody Platform authenticated, and the address on their account still has to be the
address you invited.

Invitations lapse after `INVITATION_VALIDITY_DAYS` (14 by default). Only one can be open per
address per organization; inviting somebody again while one is open is refused, so resend rather
than reissue.

**They already have a Platform account and you know its identifier.** Admit them directly.

```
POST /api/v1/identity/members
{ "platformUserId": "…" }
```

The same call readmits somebody who previously left. It is the same person and the same
membership record, revived — not a second identity, which is what you would otherwise be forced
to create for a rehire.

---

## Removing access

Three different acts, and the difference matters:

| You want to | Do this | Effect |
| ----------- | ------- | ------ |
| Stop somebody working here temporarily | `PATCH /members/:id` with `"transition": "suspend"` | They cannot open any request in this organization. Their other organizations are unaffected. Reversible with `"reinstate"` |
| Record that they have left | `PATCH /members/:id` with `"transition": "end"` | Their portals close and the cover they had arranged is withdrawn, automatically. Their history stays |
| Take away one application | `DELETE /portals/:assignmentId` | Removes an application from their home screen. Does **not** change what they are permitted to do |

Suspending and ending both require a stated reason. Reinstating does not — it restores a state
that already existed, and there is nothing to review later.

**Ending a membership deletes nothing.** Their employment history, their delegations, and every
audit row naming them survive it. That is deliberate: a system that could erase them could not
answer for itself afterwards.

---

## Portals are not permissions

This is the distinction most often collapsed, and it is worth being clear about.

Opening the **manager portal** to somebody says "this organization expects this person to use the
manager application". It says nothing about whether they may approve a particular leave request.
That is a *permission*, and permissions come from Platform's RBAC.

So revoking the manager portal does not revoke anybody's ability to approve anything. If that is
what you need, change their permissions in Platform.

---

## Jobs

A person may hold several jobs here at once — a second contract, a secondment, a role at two
legal entities of the same group. Exactly one is marked as their **main job**, and promoting a
second automatically steps the first down; the database refuses to hold two, so this cannot drift.

Detaching a job never removes the person. Somebody who leaves one of two jobs still works here,
and somebody who leaves their only job still has a leave balance to be paid out.

---

## Cover and delegation

When somebody will be away, record who acts for them:

```
POST /api/v1/identity/members/:membershipId/delegations
{ "delegateMembershipId": "…", "scope": "leave.approve",
  "effectiveFrom": "2026-09-01T00:00:00.000Z",
  "effectiveTo":   "2026-09-15T00:00:00.000Z",
  "reason": "annual leave" }
```

The delegate must be an active member. Nobody may delegate to themselves — it reads in the
register as arranged cover while arranging none.

Cover is in force strictly between its dates: inclusive at the start, exclusive at the end, so two
consecutive arrangements never overlap. Withdrawing it early takes effect immediately. From Phase
16, Workflow routes approvals using this register.

---

## Language, calendar and direction

Every member has their own language, calendar, time zone and numerals, seeded from the
organization's defaults and changed by them, not by you:

```
PUT /api/v1/identity/members/:membershipId/preferences
{ "language": "ar", "calendar": "hijri", "timeZone": "Asia/Riyadh",
  "numerals": "arabic-indic", "expectedVersion": 3 }
```

Reading direction follows the language and is not separately settable — a right-to-left language
rendered left to right is a broken screen, not a preference somebody holds. Arabic with Western
numerals is a legitimate and common combination, so numerals are chosen independently.

A member's **display name is required in both Arabic and English**. This is refused, not warned
about, and it is refused by the database as well as the application. The alternative is an org
chart that reads correctly in English and shows Latin characters in the middle of an Arabic page,
forever, because nobody was ever asked for the second name.

---

## Concurrent edits

Every change to an existing record carries the version you read (`expectedVersion`). If somebody
else changed it in between, your write is refused with **409 Conflict** rather than silently
overwriting theirs. Reload and decide again — that is the intended workflow, not an error to work
around.

---

## What the status codes mean

| Code | Meaning | What to do |
| ---- | ------- | ---------- |
| 400 | The request was malformed | Fix the payload. The response names the field |
| 401 | Not signed in, or no organization resolved for this account | Sign in; if you are signed in, you may not be an active member of the organization you asked for |
| 403 | Signed in, but lacking the permission | Permissions come from Platform |
| 404 | No such record **in this organization** | Indistinguishable from one that never existed, deliberately |
| 409 | Somebody else changed it first | Reload and retry |
| 422 | Well formed, and the business refused it | Read the message. Resending the same request unchanged will always fail |

Every error is RFC 9457 Problem Details and carries a `requestId` and `correlationId`. Quote them
in a support request: they are what turns a conversation into a log query.

---

## Operational checks

| Endpoint | Question it answers | Who asks |
| -------- | ------------------- | -------- |
| `/health/live` | Is the process running? | The orchestrator, to decide whether to restart it |
| `/health/ready` | Can it serve traffic? | The orchestrator, to decide whether to route to it |
| `/health` | What is the state of it and its dependencies? | A person |

These are unauthenticated by design and expose no configuration. They are also unversioned, so an
orchestrator's probe URL survives an API version bump.

**If every business endpoint returns 401,** the most likely cause is that Platform's
authentication adapter has not been configured for this deployment. That is the intended failure
direction — a deployment that forgets it serves nothing rather than serving everything — but it
looks alarming the first time.

**If the application refuses to start** citing row-level security, it is connected as a database
role that could bypass tenant isolation, usually the migration role or a superuser. Connect as
the unprivileged application role. The check exists because that single misconfiguration disables
every tenant policy while every screen keeps working.
