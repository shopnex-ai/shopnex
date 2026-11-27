import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ORPCError } from '@orpc/client'
import { isNotFound } from '@tanstack/react-router'
import { isMissing, orNotFound } from '../src/lib/not-found'

describe('isMissing', () => {
  test('a record that is not there, or an id that is not even valid, is missing', () => {
    assert.equal(isMissing(new ORPCError('NOT_FOUND')), true)
    assert.equal(isMissing(new ORPCError('BAD_REQUEST')), true)
  })

  test('works on what crossed the server-function boundary, which is not an ORPCError any more', () => {
    assert.equal(isMissing({ code: 'NOT_FOUND', message: 'Not Found' }), true)
  })

  test('any other failure is not “missing”', () => {
    assert.equal(isMissing(new ORPCError('INTERNAL_SERVER_ERROR')), false)
    assert.equal(isMissing(new ORPCError('UNAUTHORIZED')), false)
    assert.equal(isMissing(new Error('Not Found')), false)
    assert.equal(isMissing(null), false)
    assert.equal(isMissing(undefined), false)
    assert.equal(isMissing('NOT_FOUND'), false)
  })
})

describe('orNotFound', () => {
  test('passes a loaded record through', async () => {
    assert.deepEqual(await orNotFound(Promise.resolve({ id: '1' })), { id: '1' })
  })

  test('turns a missing record into the router’s notFound()', async () => {
    await assert.rejects(orNotFound(Promise.reject(new ORPCError('NOT_FOUND'))), (error) => isNotFound(error))
    await assert.rejects(orNotFound(Promise.reject(new ORPCError('BAD_REQUEST'))), (error) => isNotFound(error))
  })

  test('leaves every other error as it is', async () => {
    const boom = new ORPCError('INTERNAL_SERVER_ERROR', { message: 'boom' })
    await assert.rejects(orNotFound(Promise.reject(boom)), (error) => error === boom)
  })
})
