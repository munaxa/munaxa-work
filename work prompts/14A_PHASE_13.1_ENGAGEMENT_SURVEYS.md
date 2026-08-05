# 14A_PHASE_13_1_ENGAGEMENT_SURVEYS.md

# Enterprise Architecture Specification
## Munaxa Work
### Phase 13.1 – Employee Engagement & Surveys

Version: 1.0

Status: Approved

---

# IMPORTANT

This phase implements the Engagement Domain.

Engagement owns surveys, questionnaires, pulse checks, engagement scores and recognition.

It does NOT own Performance evaluation — Performance measures how an employee performs;
Engagement measures how employees experience the organization.

Confidentiality is the product. A survey that employees believe is attributable produces
answers that are worthless, so anonymity is enforced structurally rather than promised in a
policy.

---

# Prerequisites

Phases 0 through 13.

---

# Objectives

Configurable surveys and questionnaires in both languages.

Anonymous, confidential and attributed response modes.

Pulse surveys and scheduled cycles.

Engagement scoring and trend analysis.

Recognition and appreciation.

Exit and onboarding survey integration.

Action planning from results.

---

# Non Goals

Do NOT implement

Performance reviews or 360 evaluation — Performance owns those.

Exit interviews themselves — Offboarding owns the interview; this domain may supply the
instrument.

Notification delivery.

---

# Mandatory Architecture Decisions

## AD-001

Response mode is declared per survey and is immutable once the survey is published: anonymous,
confidential or attributed.

## AD-002

Anonymous responses are stored with no link to the respondent, and the link is never created
anywhere — not in a log, not in an audit row, not in an export. Anonymity is a storage property.

## AD-003

Results are suppressed below a configurable minimum response count, so a small team cannot be
de-anonymized by segmentation. The threshold applies to every breakdown, including intersecting
filters.

## AD-004

Surveys, questions, scales and scoring are tenant configurable. Nothing is hardcoded.

## AD-005

Questions are authored in both languages, and a survey cannot publish with a missing
translation.

## AD-006

Engagement scores are projections. Recomputation from responses is always possible.

## AD-007

Supports Audit, Soft Delete, Optimistic Concurrency and Metadata. Audit records the survey
lifecycle, never the content of an anonymous response.

---

# Domain model

**Survey** — code, type, response mode, population, schedule, state, languages.

**Question** — text per language, type, scale, required, conditional display, category.

**SurveyCycle** — a scheduled instance with its window and reminders.

**Invitation** — issued participation token. For anonymous surveys the token proves eligibility
and completion without identifying the respondent.

**Response** — answers, submission time, segment attributes captured at issue.

**EngagementScore** — projection by dimension, segment and period, subject to suppression.

**Recognition** — peer or manager appreciation, optionally public, with categories and history.

**ActionPlan** — actions arising from results, their owners and their progress.

---

# Lifecycle

Draft → Translated → Published → Open → Closed → Analyzed → Actioned → Archived.

---

# Domain events

`SurveyPublished`, `SurveyOpened`, `SurveyClosed`, `ResponseSubmitted` (carrying no respondent
identity for anonymous surveys), `ScoreComputed`, `RecognitionGiven`, `ActionPlanCreated`.

---

# Acceptance criteria

✓ Anonymous responses provably unlinkable, verified by test and by schema inspection

✓ Suppression threshold enforced on every breakdown, including intersecting filters

✓ Surveys cannot publish with a missing translation

✓ Scores recomputable from responses

✓ Participation tracked without breaking anonymity

✓ Employees complete surveys on mobile

✓ Quality gates pass

---

# Definition of Done

A tenant can run engagement and pulse surveys in both languages with credible anonymity, and act
on the results without ever being able to identify a respondent who was promised anonymity.
