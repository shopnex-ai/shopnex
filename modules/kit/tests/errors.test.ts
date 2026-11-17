import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { defineError, domainErrorData, domainErrorStatus, isDomainError, type ErrorCode } from '../src'

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

describe('the mark of a domain error', () => {
  test('is on every class made with defineError and on classes that extend one', () => {
    class Special extends defineError('Special', { A: 'CONFLICT' }) {}
    assert.equal(isDomainError(new ThingError('TAKEN', 'x')), true)
    assert.equal(isDomainError(new Special('A', 'x')), true)
  })

  test('is not on any other error or value', () => {
    assert.equal(isDomainError(new Error('x')), false)
    assert.equal(isDomainError(Object.assign(new Error('x'), { code: 'TAKEN' })), false)
    assert.equal(isDomainError({ code: 'TAKEN', message: 'x' }), false)
    assert.equal(isDomainError('TAKEN'), false)
    assert.equal(isDomainError(null), false)
  })

  test('is a symbol shared by every copy of the package, so a second copy of a module is still recognized', () => {
    const fromAnotherCopy = Object.assign(new Error('x'), { code: 'TAKEN' })
    Object.defineProperty(fromAnotherCopy, Symbol.for('shopnex.domain-error'), { value: true })
    assert.equal(isDomainError(fromAnotherCopy), true)
  })

  test('lets the error say its own status, including through a subclass', () => {
    class Special extends defineError('Special', { A: 'CONFLICT', B: 'NOT_FOUND' }) {}
    assert.equal(domainErrorStatus(new ThingError('NOT_THERE', 'x')), 'NOT_FOUND')
    assert.equal(domainErrorStatus(new Special('B', 'x')), 'NOT_FOUND')
    const outside = new ThingError('TAKEN', 'x') as unknown as { code: string }
    outside.code = 'OTHER'
    assert.equal(domainErrorStatus(outside as unknown as Error & { code: string }), undefined)
  })
})

describe('the data of a response', () => {
  test('is the code, and a class can add fields (an OAuth error also names itself as `error`)', () => {
    const Oauth = defineError('Oauth', { invalid_client: 'UNAUTHORIZED' }, { data: (code) => ({ error: code }) })
    assert.deepEqual(domainErrorData(new ThingError('TAKEN', 'x')), { code: 'TAKEN' })
    assert.deepEqual(domainErrorData(new Oauth('invalid_client', 'x')), {
      code: 'invalid_client',
      error: 'invalid_client',
    })
  })

  test('also through a subclass', () => {
    class Special extends defineError('Special', { A: 'CONFLICT' }, { data: () => ({ extra: true }) }) {}
    assert.deepEqual(domainErrorData(new Special('A', 'x')), { code: 'A', extra: true })
  })
})
