/** The draft was changed (or published) after the one the client saw */
export class DraftConflictError extends Error {
  constructor(readonly rev: number) {
    super('This was changed somewhere else. Reload to see the latest.')
  }
}
