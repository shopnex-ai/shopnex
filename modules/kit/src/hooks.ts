// A hook: a point where one module lets others act without knowing them. The module that owns it (`apps` owns `appUninstalled`) runs it
// inside its own transaction; the modules that care (`payments` removes the method of the app) add a listener when they load, so the
// owner never imports them: a dependency that would otherwise run against the graph (payments already depends on apps, not the other
// way round).
//
//   export const appUninstalled = defineHook<{ shopId: string; appId: string }, Conn>('app.uninstalled')
//   await appUninstalled.run(tx, { shopId, appId })                      // in apps, in the uninstall transaction
//   appUninstalled.on('payments.method', (tx, { shopId, appId }) => …)   // in payments, when it loads
//
// A listener has an id: adding the same id again replaces it, so a module loaded twice (a dev server reloading) does not run twice. The
// listeners are kept on globalThis, like the resolvers of @shopnex/rpc, so every copy of this package sees the same ones.

export type HookListener<Payload, Conn> = (conn: Conn, payload: Payload) => Promise<void> | void

export interface Hook<Payload, Conn = unknown> {
  /** Adds a listener under an id, or replaces the one with that id */
  on(id: string, listener: HookListener<Payload, Conn>): void
  /** Calls the listeners one after the other, in the order they were added, with the caller's connection; the first to throw stops the rest */
  run(conn: Conn, payload: Payload): Promise<void>
  /** The ids of the listeners, so a startup check or a test can assert the ones it expects are there */
  readonly listeners: string[]
}

const REGISTRY = Symbol.for('shopnex.hooks')

export function defineHook<Payload, Conn = unknown>(name: string): Hook<Payload, Conn> {
  const store = ((globalThis as Record<symbol, Map<string, Map<string, unknown>> | undefined>)[REGISTRY] ??= new Map())
  const listeners = (store.get(name) ?? store.set(name, new Map()).get(name)!) as Map<
    string,
    HookListener<Payload, Conn>
  >
  return {
    on: (id, listener) => void listeners.set(id, listener),
    async run(conn, payload) {
      for (const listener of listeners.values()) await listener(conn, payload)
    },
    get listeners() {
      return [...listeners.keys()]
    },
  }
}
