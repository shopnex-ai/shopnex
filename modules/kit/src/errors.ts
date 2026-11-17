// Domain errors with their HTTP status declared next to their codes, in the module's `<name>.errors.ts`:
//
//   export const CustomFieldError = defineError('CustomFieldError', {
//     FIELD_NOT_FOUND: 'NOT_FOUND',
//     KEY_TAKEN: 'CONFLICT',
//     INVALID_VALUE: 'BAD_REQUEST',
//   })
//   throw new CustomFieldError('KEY_TAKEN', 'A product field with this key already exists')
//
// The table is plain strings, so domain code stays free of HTTP and oRPC imports, and it is all a module has to write:
// @shopnex/rpc answers any error made with `defineError` with its status (the code goes in `data`, the error is the cause).
// An error that carries more than a code (typed data for the storefront) extends the class:
//
//   export class OrderError extends defineError('OrderError', { ... }) {
//     constructor(code: OrderErrorCode, message: string, readonly data: OrderErrorData = {}) { super(code, message) }
//   }

/** The statuses an error code can answer with: the oRPC / HTTP error codes, as strings */
export type ErrorStatus =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNPROCESSABLE_CONTENT'
  | 'TOO_MANY_REQUESTS'
  | 'BAD_GATEWAY'
  | 'SERVICE_UNAVAILABLE'

/** Turns an error into the error a route answers with, or undefined when it is not one the mapper knows */
export type ErrorMapper = (error: unknown) => Error | undefined

// The mark of a class made with defineError. A mark, not `instanceof`, so it still works when two copies of a module are loaded
// (a dev server reloading, a bundle that includes a package twice).
const MARK = Symbol.for('shopnex.domain-error')

/** Whether the error came from a class made with `defineError` (or one that extends it) */
export function isDomainError(error: unknown): error is DomainErrorInstance {
  return (
    error instanceof Error &&
    (error as unknown as Record<symbol, unknown>)[MARK] === true &&
    typeof (error as { code?: unknown }).code === 'string'
  )
}

/** The status its class declares for its code, or undefined when the class has no entry for it (a subclass passing a code outside the table) */
export function domainErrorStatus(error: DomainErrorInstance): ErrorStatus | undefined {
  const statuses = (error.constructor as { statuses?: Readonly<Record<string, ErrorStatus>> }).statuses
  return statuses?.[error.code]
}

export interface DomainErrorInstance<Code extends string = string> extends Error {
  readonly code: Code
}

export interface DomainErrorClass<Code extends string = string> {
  new (code: Code, message: string): DomainErrorInstance<Code>
  /** The status of each code */
  readonly statuses: Readonly<Record<Code, ErrorStatus>>
}

/** The codes of an error class made with `defineError`: `type CustomFieldErrorCode = ErrorCode<typeof CustomFieldError>` */
export type ErrorCode<C> = C extends DomainErrorClass<infer Code> ? Code : never

export function defineError<const T extends Record<string, ErrorStatus>>(
  name: string,
  statuses: T,
): DomainErrorClass<keyof T & string> {
  class Domain extends Error {
    static readonly statuses = statuses
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message)
      this.name = name
    }
  }
  Object.defineProperty(Domain.prototype, MARK, { value: true })
  return Domain as unknown as DomainErrorClass<keyof T & string>
}
