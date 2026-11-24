/**
 * Maps database errors from `save_revision` to the stable public error envelope.
 * Pure so it can be unit tested. Anything unmapped is a server fault (500).
 */
export type DatabaseError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
};

export type MappedError = {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  headers?: Record<string, string>;
};

const featureCodes = new Set([
  "invalid_feature",
  "duplicate_feature_id",
  "invalid_feature_kind",
  "kind_not_supported",
  "invalid_feature_properties",
  "invalid_geometry",
  "too_many_vertices",
  "too_many_features",
]);

function featureIndex(details: string | null | undefined) {
  const index = Number(details);
  return Number.isInteger(index) && index >= 0
    ? { featureIndex: index }
    : undefined;
}

export function mapPublishRevisionError(
  error: DatabaseError,
): MappedError | null {
  switch (error.code) {
    case "28000":
      return {
        status: 401,
        code: "authentication_required",
        message: "Sign in to publish a revision.",
      };
    case "P0002":
      return {
        status: 404,
        code: "revision_not_found",
        message: "The revision was not found.",
      };
    case "FT001":
      return {
        status: 409,
        code: "idempotency_conflict",
        message: "That request key was already used for different data.",
      };
    case "FT409":
      return {
        status: 409,
        code: "already_published",
        message: "This revision is already published.",
        details: error.details ? { publicationId: error.details } : undefined,
      };
    case "FT422":
      return {
        status: 422,
        code:
          error.message === "empty_revision"
            ? "empty_revision"
            : "invalid_publication",
        message: "This revision cannot be published.",
      };
    case "22023":
      // The user cannot fix a missing profile from the form, so it gets its own code.
      return error.message === "missing_profile"
        ? {
            status: 409,
            code: "profile_required",
            message: "A public alias is required before publishing.",
          }
        : {
            status: 422,
            code: "invalid_publication",
            message: "The publication data is invalid.",
          };
    default:
      return null;
  }
}

const mergeDomainCodes = new Set([
  "merge_incompatible",
  "nothing_to_merge",
  "already_merged",
  "ancestor_limit_exceeded",
  "invalid_resolution",
  "unresolved_conflicts",
  "too_many_features",
]);

function parseJsonDetail(details: string | null | undefined) {
  if (!details) return undefined;
  try {
    const value: unknown = JSON.parse(details);
    return Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Maps merge_preview and merge_commit errors to the stable public envelope. */
export function mapMergeError(error: DatabaseError): MappedError | null {
  switch (error.code) {
    case "28000":
      return {
        status: 401,
        code: "authentication_required",
        message: "Sign in to merge.",
      };
    case "P0002":
      return error.message === "publication_not_found"
        ? {
            status: 404,
            code: "publication_not_found",
            message: "The source publication was not found.",
          }
        : {
            status: 404,
            code: "branch_not_found",
            message: "The branch was not found.",
          };
    case "FT001":
      return {
        status: 409,
        code: "idempotency_conflict",
        message: "That request key was already used for different data.",
      };
    case "FT409":
      return {
        status: 409,
        code: "stale_head",
        message: "The branch changed since the merge preview.",
        details: error.details ? { currentHeadId: error.details } : undefined,
      };
    case "FT422": {
      const code =
        error.message && mergeDomainCodes.has(error.message)
          ? error.message
          : "invalid_merge";
      const items = parseJsonDetail(error.details);
      return {
        status: 422,
        code,
        message: "The merge cannot be completed as requested.",
        details:
          code === "unresolved_conflicts" && items
            ? { conflictIds: items }
            : code === "invalid_resolution" && items
              ? { invalidResolutions: items }
              : undefined,
      };
    }
    case "23514":
      return error.message === "feature_outside_site"
        ? {
            status: 422,
            code: "feature_outside_site",
            message: "A feature lies outside the study boundary.",
          }
        : null;
    case "22023":
      return {
        status: 400,
        code: "invalid_merge_request",
        message: "The merge request is invalid.",
      };
    default:
      return null;
  }
}

export function mapSaveRevisionError(error: DatabaseError): MappedError | null {
  switch (error.code) {
    case "28000":
      return {
        status: 401,
        code: "authentication_required",
        message: "Sign in to save a revision.",
      };
    case "P0002":
      return {
        status: 404,
        code: "branch_not_found",
        message: "The branch was not found.",
      };
    case "FT001":
      return {
        status: 409,
        code: "idempotency_conflict",
        message: "That request key was already used for different data.",
      };
    case "FT409":
      return {
        status: 409,
        code: "stale_head",
        message: "The branch changed since this revision was started.",
        details: error.details ? { currentHeadId: error.details } : undefined,
      };
    case "FT422": {
      const code =
        error.message && featureCodes.has(error.message)
          ? error.message
          : "invalid_feature";
      return {
        status: 422,
        code,
        message: "A feature in the revision is invalid.",
        details: featureIndex(error.details),
      };
    }
    case "23514":
      return error.message === "feature_outside_site"
        ? {
            status: 422,
            code: "feature_outside_site",
            message: "A feature lies outside the study boundary.",
          }
        : null;
    case "22023":
      return {
        status: 400,
        code: "invalid_revision_request",
        message: "The revision request is invalid.",
      };
    default:
      return null;
  }
}

const communityNotFound: Record<string, string> = {
  publication_not_found: "The publication was not found.",
  target_not_found: "The content was not found.",
  comment_not_found: "The comment was not found.",
  site_not_found: "The site was not found.",
  report_not_found: "The report was not found.",
};

const communityConflicts = new Set([
  "moderation_state_unchanged",
  "report_already_resolved",
]);

/** Maps community and moderation RPC errors to the stable public envelope. */
export function mapCommunityError(error: DatabaseError): MappedError | null {
  switch (error.code) {
    case "28000":
      return {
        status: 401,
        code: "authentication_required",
        message: "Sign in to continue.",
      };
    case "P0002": {
      const code =
        error.message && Object.hasOwn(communityNotFound, error.message)
          ? error.message
          : "not_found";
      return {
        status: 404,
        code,
        message: communityNotFound[code] ?? "The resource was not found.",
      };
    }
    case "FT001":
      return {
        status: 409,
        code: "idempotency_conflict",
        message: "That request key was already used for different data.",
      };
    case "FT409": {
      const code =
        error.message && communityConflicts.has(error.message)
          ? error.message
          : "conflict";
      return {
        status: 409,
        code,
        message: "The request conflicts with the current state.",
      };
    }
    case "FT422":
    case "23503": {
      // 23503 is the foreign-key backstop for an anchor that is not in the revision.
      const code =
        error.code === "23503" || error.message === "invalid_anchor"
          ? "invalid_anchor"
          : error.message === "report_mismatch"
            ? "report_mismatch"
            : "invalid_request";
      return {
        status: 422,
        code,
        message: "The request data is not valid for this content.",
      };
    }
    case "FT429": {
      const seconds = Math.max(
        1,
        Number.parseInt(error.details ?? "", 10) || 60,
      );
      return {
        status: 429,
        code: "rate_limited",
        message: "Too many requests. Try again later.",
        details: { retryAfterSeconds: seconds },
        headers: { "Retry-After": String(seconds) },
      };
    }
    case "22023":
      return {
        status: 422,
        code: "invalid_request",
        message: "The request data is invalid.",
      };
    default:
      return null;
  }
}

const dossierNotFound: Record<string, string> = {
  publication_not_found: "The publication was not found.",
  dossier_not_found: "The dossier was not found.",
  milestone_not_found: "The milestone was not found.",
  evidence_not_found: "The evidence was not found.",
};

const dossierConflicts = new Set([
  "stale_state",
  "stale_milestone",
  "dossier_closed",
  "publication_hidden",
]);

const dossierInvalid = new Set([
  "transition_not_allowed",
  "note_required",
  "plan_requires_responsible",
  "plan_requires_milestone",
  "start_requires_note",
  "start_requires_evidence",
  "execute_requires_observation",
  "execute_requires_evidence",
  "discard_requires_reason",
  "invalid_evidence_reference",
  "invalid_evidence_url",
  "evidence_date_in_future",
  "too_many_milestones",
  "too_many_evidence",
  "event_limit_reached",
  "milestone_transition_not_allowed",
  "correction_not_allowed",
]);

/** Maps dossier RPC errors to the stable envelope; every code comes from a closed list. */
export function mapDossierError(error: DatabaseError): MappedError | null {
  switch (error.code) {
    case "28000":
      return {
        status: 401,
        code: "authentication_required",
        message: "Sign in to continue.",
      };
    case "P0002": {
      const code =
        error.message && Object.hasOwn(dossierNotFound, error.message)
          ? error.message
          : "not_found";
      return {
        status: 404,
        code,
        message: dossierNotFound[code] ?? "The resource was not found.",
      };
    }
    case "FT001":
      return {
        status: 409,
        code: "idempotency_conflict",
        message: "That request key was already used for different data.",
      };
    case "FT409": {
      const code =
        error.message && dossierConflicts.has(error.message)
          ? error.message
          : "conflict";
      return {
        status: 409,
        code,
        message: "The request conflicts with the current state.",
        details:
          (code === "stale_state" || code === "stale_milestone") &&
          error.details
            ? { currentState: error.details }
            : undefined,
      };
    }
    case "FT422": {
      const code =
        error.message && dossierInvalid.has(error.message)
          ? error.message
          : "invalid_request";
      return {
        status: 422,
        code,
        message: "The request does not meet the requirements of this change.",
      };
    }
    case "22023":
      return {
        status: 422,
        code: "invalid_request",
        message: "The request data is invalid.",
      };
    default:
      return null;
  }
}
