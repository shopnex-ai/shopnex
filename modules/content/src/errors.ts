export type ContentErrorCode = 'MENU_NOT_FOUND' | 'PAGE_NOT_FOUND' | 'HANDLE_TAKEN' | 'RESOURCE_NOT_FOUND'

// Domain error; the API layer maps it to an HTTP error
export class ContentError extends Error {
  constructor(
    readonly code: ContentErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ContentError'
  }
}
