// Plain ESM with types in index.d.ts, so apps can load it in the browser without a build step.
/** @typedef {import('./protocol').AppRequest} AppRequest */
/** @typedef {import('./protocol').AdminMessage} AdminMessage */
/** @typedef {import('./index').AppBridge} AppBridge */

/**
 * @param {{ instance?: string; timeoutMs?: number }} [options]
 * @returns {AppBridge}
 */
export function createAppBridge(options = {}) {
  const param = new URLSearchParams(window.location.search).get('instance')
  const instance = options.instance ?? param
  if (!instance) throw new Error('createAppBridge: no instance (open the app from the Shopnex admin)')
  const origin = new URL(instance).origin
  if (window.parent === window) throw new Error('createAppBridge: not embedded in the Shopnex admin')
  const timeoutMs = options.timeoutMs ?? 10_000

  /** @type {Map<string, (message: AdminMessage) => void>} */
  const waiting = new Map()
  window.addEventListener('message', (event) => {
    // Only the admin window we're embedded in, on the instance's origin
    if (event.source !== window.parent || event.origin !== origin) return
    /** @type {AdminMessage} */
    const message = event.data
    if (message?.source !== 'shopnex-admin') return
    waiting.get(message.id)?.(message)
  })

  /**
   * @param {AppRequest} body
   * @returns {Promise<AdminMessage>}
   */
  function send(body) {
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(id)
        reject(new Error(`Shopnex admin didn't answer "${body.type}"`))
      }, timeoutMs)
      waiting.set(id, (message) => {
        clearTimeout(timer)
        waiting.delete(id)
        if (message.type === 'error') reject(new Error(message.message))
        else resolve(message)
      })
      window.parent.postMessage({ ...body, source: 'shopnex-app', v: 1, id }, origin)
    })
  }

  /** @type {AppBridge} */
  const bridge = {
    instance: origin,
    async getSessionToken() {
      const reply = await send({ type: 'session-token' })
      if (reply.type !== 'session-token') throw new Error('Unexpected reply')
      return reply.token
    },
    async authenticatedFetch(input, init = {}) {
      const headers = new Headers(init.headers)
      headers.set('authorization', `Bearer ${await bridge.getSessionToken()}`)
      return fetch(input, { ...init, headers })
    },
    async toast(message, { isError = false } = {}) {
      await send({ type: 'toast', message, isError })
    },
    async redirect(url) {
      await send({ type: 'redirect', url: new URL(url, window.location.href).toString() })
    },
  }
  return bridge
}
