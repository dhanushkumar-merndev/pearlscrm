"use client";

import { useEffect, useState } from "react";

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { searchPatientsAction } from "@/server/actions/patients";
import type { PatientSearchHit } from "@/server/queries/patients";

type Answer = { q: string; hits: PatientSearchHit[]; error: string | null };

/** Debounced File ID / name / phone lookup. Answers to stale queries are ignored. */
export function usePatientSearch(query: string) {
  const trimmed = query.trim();
  const debounced = useDebouncedValue(trimmed, 200);
  const [answer, setAnswer] = useState<Answer>({ q: "", hits: [], error: null });

  useEffect(() => {
    if (!debounced) return;
    let cancelled = false;
    searchPatientsAction({ q: debounced }).then((result) => {
      if (cancelled) return;
      setAnswer(
        result.ok
          ? { q: debounced, hits: result.data, error: null }
          : { q: debounced, hits: [], error: result.error.message },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  if (!trimmed) return { hits: [], loading: false, error: null };
  const current = answer.q === trimmed;
  return {
    hits: current ? answer.hits : [],
    loading: !current,
    error: current ? answer.error : null,
  };
}
