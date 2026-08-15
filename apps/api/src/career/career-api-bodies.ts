/**
 * The published shapes the API suites read, and the one cast per read that produces them.
 *
 * `supertest` types a response body as `any`, and reaching into it directly would put an implicit
 * `any` on every assertion in every suite. Declared here rather than inside the fixture because they
 * are a description of the *wire*, not of the harness: they are what a client would write down, and
 * a field that disappeared from a response would stop compiling here first.
 */
export interface PageBody<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}

export interface ProblemBody {
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly correlationId?: string;
}

export interface CreatedBody {
  readonly pathId?: string;
  readonly stageId?: string;
  readonly careerPlanId?: string;
  readonly talentPoolId?: string;
  readonly membershipId?: string;
  readonly successionPlanId?: string;
  readonly successorId?: string;
  readonly readinessLevelId?: string;
  readonly readinessAssessmentId?: string;
  readonly developmentPlanId?: string;
  readonly developmentItemId?: string;
  readonly mobilityRecommendationId?: string;
  readonly created?: boolean;
}

export interface PathDetailBody {
  readonly path: { readonly pathId: string; readonly status: string; readonly version: number };
  readonly stages: readonly {
    readonly stageId: string;
    readonly sequence: number;
    readonly targetPositionId?: string;
  }[];
}

export interface SuccessionDetailBody {
  readonly plan: {
    readonly successionPlanId: string;
    readonly status: string;
    readonly version: number;
    readonly reviewDue?: boolean;
  };
  readonly successors: readonly {
    readonly successorId: string;
    readonly employmentId: string;
    readonly status: string;
    readonly rank?: number;
    readonly version: number;
  }[];
}

export interface ReadinessHistoryBody {
  readonly employmentId: string;
  readonly assessments: readonly {
    readonly assessmentId: string;
    readonly assessedOn: string;
    readonly readinessLevelId: string;
  }[];
  readonly latest?: { readonly assessedOn: string };
}

export interface DevelopmentPlanBody {
  readonly plan: {
    readonly developmentPlanId: string;
    readonly status: string;
    readonly version: number;
  };
  readonly items: readonly {
    readonly developmentItemId: string;
    readonly status: string;
    readonly category: string;
    readonly version: number;
  }[];
  readonly mix: { readonly mixVerdict: string };
}
