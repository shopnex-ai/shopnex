// A service whose functions take the database connection as their last argument (so a caller inside a transaction passes its
// `tx`), seen from a route handler that always runs on the shared connection: `bindConn(service, db)` fills that last argument in.
// Only for the one place allowed to hold `db` (a module's router); services still take the connection, and the lint rule
// that keeps them from importing `db` is what makes a transaction safe.

/** The service with the trailing `C` parameter of each function taken away; what is not a function is left as it is */
export type WithoutConn<S, C> = {
  [K in keyof S]: S[K] extends (...args: [...infer A, C]) => infer R ? (...args: A) => R : S[K]
}

export function bindConn<S extends object, C>(service: S, conn: C): WithoutConn<S, C> {
  const bound: Record<string, unknown> = {}
  for (const [name, member] of Object.entries(service)) {
    bound[name] =
      typeof member === 'function'
        ? (...args: unknown[]) => (member as (...all: unknown[]) => unknown)(...args, conn)
        : member
  }
  return bound as WithoutConn<S, C>
}
