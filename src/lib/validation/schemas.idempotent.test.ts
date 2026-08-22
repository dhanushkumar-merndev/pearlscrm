import { describe, expect, it } from "vitest";

import {
  addReviewCommentSchema,
  createCaseSchema,
  createFollowupSchema,
  decideEditRequestSchema,
  requestCaseEditSchema,
  updateCaseSchema,
  updateVisitSchema,
} from "@/lib/validation/schemas";

/**
 * Every form schema is parsed twice: once in the browser through `zodResolver`,
 * and again on the server, which never trusts the client's pass. That makes the
 * output of a transform its own next input, so every transform has to be
 * idempotent.
 *
 * It is easy to break without noticing. `""` transformed to `null` reads fine
 * in isolation, but `.optional()` accepts only `undefined` — so the second
 * parse rejected the first parse's own output, and the case form failed with
 * "please correct the highlighted fields" pointing at a field that was not on
 * screen. These tests exist so that never ships again.
 */

const CASE_ID = "3f2a9c1e-4b6d-4f8a-9c1e-2b7d5a3e8f04";
const TYPE_ID = "7e1b4d20-8c3f-4a19-b6d2-9f5c1e7a3b08";
const VISIT_ID = "c4d8b6a2-1e3f-4c5d-8a9b-0f2e4d6c8a1b";

/** Parses twice and asserts the second pass neither fails nor changes anything. */
function expectStable(schema: { parse: (input: unknown) => unknown }, input: unknown) {
  const once = schema.parse(input);
  const twice = schema.parse(once);
  expect(twice).toEqual(once);
}

describe("form schemas are safe to parse twice", () => {
  it("createCase — every optional field left blank", () => {
    expectStable(createCaseSchema, {
      procedureId: CASE_ID,
      procedureTypeId: TYPE_ID,
      surgeryDate: "2026-08-20",
      followupAvailability: "",
      consent: "NOT_RECORDED",
      consentNotes: "",
      tagIds: [],
    });
  });

  it.each(["YES", "NO", "NOT_RECORDED"] as const)(
    "createCase — consent %s with no note",
    (consent) => {
      expectStable(createCaseSchema, {
        procedureId: CASE_ID,
        procedureTypeId: TYPE_ID,
        surgeryDate: "2026-08-20",
        followupAvailability: "3",
        consent,
        consentNotes: "",
        tagIds: [],
      });
    },
  );

  it("updateCase — blank follow-up availability", () => {
    expectStable(updateCaseSchema, {
      caseId: CASE_ID,
      procedureId: CASE_ID,
      procedureTypeId: TYPE_ID,
      surgeryDate: "2026-08-20",
      followupAvailability: "",
      tagIds: [],
      expectedVersion: 1,
    });
  });

  it("createFollowup — no observation", () => {
    expectStable(createFollowupSchema, {
      caseId: CASE_ID,
      visitDate: "2026-09-20",
      displayLabel: "1 Month",
      clinicalObservation: "",
    });
  });

  it("updateVisit — no observation", () => {
    expectStable(updateVisitSchema, {
      visitId: VISIT_ID,
      visitDate: "2026-09-20",
      displayLabel: "1 Month",
      clinicalObservation: "",
    });
  });

  it("requestCaseEdit — visit scope", () => {
    expectStable(requestCaseEditSchema, {
      caseId: CASE_ID,
      scope: "VISIT_IMAGES",
      visitId: VISIT_ID,
      reason: "The Right 45 view is out of frame and needs retaking.",
    });
  });

  it("decideEditRequest — no note", () => {
    expectStable(decideEditRequestSchema, {
      requestId: CASE_ID,
      approve: true,
      additionalScopes: [],
      note: "",
      ttlHours: 168,
    });
  });

  it("addReviewComment", () => {
    expectStable(addReviewCommentSchema, {
      caseId: CASE_ID,
      body: "The dorsal reduction reads as 2 mm here; it was closer to 4.",
    });
  });
});
