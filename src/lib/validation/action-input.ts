import type { z } from "zod";

/**
 * The accepted argument type for a server action guarded by schema `S`.
 *
 * Several schemas trim and null-coerce, so a form's raw values and the schema's
 * parsed output are different shapes. Actions re-validate whatever they receive,
 * so both are legitimate inputs and callers should not have to convert.
 */
export type ActionInput<S extends z.ZodType> = z.input<S> | z.output<S>;
