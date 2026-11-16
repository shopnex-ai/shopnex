/** A mistake in how the command was used: shown as a plain message (exit 2), no stack trace */
export class UsageError extends Error {}

/** Something that cannot be done yet or here: a plain message too (exit 1) */
export class UnavailableError extends Error {}
