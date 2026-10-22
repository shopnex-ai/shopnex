export type FilesErrorCode = 'FILE_TOO_LARGE' | 'UNSUPPORTED_TYPE' | 'STORAGE_FAILED' | 'SECRET_REQUIRED'

// Domain error; the API layer maps it to an HTTP error
export class FilesError extends Error {
  constructor(
    readonly code: FilesErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'FilesError'
  }
}
