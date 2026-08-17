import type { CaseCompletionFacts } from "@/lib/types";

/**
 * Case completion.
 *
 * Completion is derived from the facts returned by `public.case_completion`,
 * never stored. Crossing a percentage threshold does not make a case complete:
 * `isComplete` requires every *required* item, and follow-up maturity is
 * tracked as a separate, non-blocking signal.
 */

export type ChecklistItem = {
  key: keyof CaseCompletionFacts | "followups";
  label: string;
  done: boolean;
  /** Required items gate `isComplete`; informational ones never do. */
  required: boolean;
  detail?: string;
};

export function buildChecklist(facts: CaseCompletionFacts): ChecklistItem[] {
  return [
    {
      key: "case_information",
      label: "Case information",
      done: facts.case_information,
      required: true,
      detail: "Procedure, procedure type and surgery date",
    },
    {
      key: "before_images",
      label: "Before images",
      done: facts.before_images,
      required: true,
      detail: `${facts.before_images_resolved} of ${facts.standard_view_count} standard views uploaded or marked unavailable`,
    },
    {
      key: "case_notes",
      label: "Case notes",
      done: facts.case_notes,
      required: true,
      detail: "Required note sections and at least one change performed",
    },
    {
      key: "consent",
      label: "Consent",
      done: facts.consent,
      required: true,
      detail: "Image use consent explicitly recorded",
    },
    {
      key: "expert_review",
      label: "Expert review",
      done: facts.expert_review,
      required: true,
      detail: "Final assessment completed by a surgeon",
    },
    {
      key: "followups",
      label: "Follow-up recorded",
      done: facts.followups,
      required: false,
      detail:
        facts.followup_count > 0
          ? `${facts.followup_count} follow-up visit${facts.followup_count === 1 ? "" : "s"} recorded`
          : "No follow-up visits recorded yet",
    },
  ];
}

/**
 * Percentage across *all* checklist items, including the informational one, so
 * the number reflects how filled-in the record looks to a clinician.
 */
export function completionPercent(facts: CaseCompletionFacts): number {
  const items = buildChecklist(facts);
  if (items.length === 0) return 0;

  const done = items.filter((item) => item.done).length;
  return Math.round((done / items.length) * 100);
}

/** True only when every *required* item is satisfied. */
export function isComplete(facts: CaseCompletionFacts): boolean {
  return buildChecklist(facts)
    .filter((item) => item.required)
    .every((item) => item.done);
}

/**
 * Data completeness and follow-up maturity are related but distinct: a case can
 * be fully complete for its current stage while later follow-ups are still due.
 */
export function followupMaturity(facts: CaseCompletionFacts): {
  hasFollowups: boolean;
  count: number;
} {
  return { hasFollowups: facts.followups, count: facts.followup_count };
}
