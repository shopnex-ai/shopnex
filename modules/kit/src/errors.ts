// Domain errors with their HTTP status declared next to their codes, in the module's `<name>.errors.ts`:
//
//   export const CustomFieldError = defineError('CustomFieldError', {
//     FIELD_NOT_FOUND: 'NOT_FOUND',
//     KEY_TAKEN: 'CONFLICT',
//     INVALID_VALUE: 'BAD_REQUEST',
//   })
//   throw new CustomFieldError('KEY_TAKEN', 'A product field with this key already exists')
//
// The table is plain strings, so domain code stays free of HTTP and oRPC imports. `mapperFor` in @shopnex/rpc turns the
// class into the `ErrorMapper` of the module's manifest. An error that needs more than a status per code (typed data
// for the storefront, a status that depends on the data) keeps a mapper of its own.

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

/** Turns an error a module throws into the error a route answers with, or undefined when it is not that module's */
export type ErrorMapper = (error: unknown) => Error | undefined

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
  return Domain as unknown as DomainErrorClass<keyof T & string>
}
