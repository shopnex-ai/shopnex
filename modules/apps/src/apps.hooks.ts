// Points where other modules act on what happens to an app, without apps knowing them (see defineHook in @shopnex/kit).
import type { Conn } from '@shopnex/db'
import { defineHook } from '@shopnex/kit'

/** An app was uninstalled from a shop. Runs inside the uninstall transaction: a listener that throws undoes the uninstall. */
export const appUninstalled = defineHook<{ shopId: string; appId: string }, Conn>('app.uninstalled')
