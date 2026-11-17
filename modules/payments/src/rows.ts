/** The row an insert or an update returned. There is always one, unless the row was deleted in the same instant: then it fails loudly. */
export function only<T>(rows: T[]): T {
  const [row] = rows
  if (!row) throw new Error('The row was not found after it was written')
  return row
}
