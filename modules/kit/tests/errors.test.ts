import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { defineError, type ErrorCode } from '../src'

const ThingError = defineError('ThingError', { NOT_THERE: 'NOT_FOUND', TAKEN: 'CONFLICT' })
const OtherError = defineError('OtherError', { BAD: 'BAD_REQUEST' })

describe('defineError', () => {
  test('makes an Error with a code and a message, named after the class', () => {
    const error = new ThingError('TAKEN', 'already there')
    assert.ok(error instanceof Error)
    assert.ok(error instanceof ThingError)
    assert.equal(error.code, 'TAKEN')
    assert.equal(error.message, 'already there')
    assert.equal(error.name, 'ThingError')
  })

  test('keeps the status of each code on the class', () => {
    assert.deepEqual({ ...ThingError.statuses }, { NOT_THERE: 'NOT_FOUND', TAKEN: 'CONFLICT' })
  })

  test('two classes are different types', () => {
    assert.ok(!(new OtherError('BAD', 'x') instanceof ThingError))
    assert.ok(!(new ThingError('TAKEN', 'x') instanceof OtherError))
  })

  test('the codes are the keys of the table (checked by the compiler)', () => {
    const code: ErrorCode<typeof ThingError> = 'NOT_THERE'
    assert.equal(code, 'NOT_THERE')
    // @ts-expect-error a code that is not in the table is not accepted
    new ThingError('MISSING', 'x')
  })
})
