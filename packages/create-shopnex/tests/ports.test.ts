import assert from 'node:assert/strict'
import { createServer, type AddressInfo, type Server } from 'node:net'
import { test } from 'node:test'
import { UsageError } from '../src/errors'
import { assertPortsFree, portInUse } from '../src/run'

const listen = () =>
  new Promise<Server>((resolve) => {
    const server = createServer((socket) => socket.end())
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
const close = (server: Server) => new Promise((resolve) => server.close(resolve))

test('a port something listens on is in use, a freed one is not', async () => {
  const server = await listen()
  const { port } = server.address() as AddressInfo
  assert.equal(await portInUse(port), true)
  await close(server)
  assert.equal(await portInUse(port), false)
})

test('a taken port is a usage error that names the flag to change it', async () => {
  const server = await listen()
  const { port } = server.address() as AddressInfo
  try {
    await assert.rejects(assertPortsFree([{ port, flag: '--storefront-port' }]), (error) => {
      assert.ok(error instanceof UsageError)
      assert.match(error.message, new RegExp(`Port ${port} is already in use.*--storefront-port`))
      return true
    })
  } finally {
    await close(server)
  }
})
