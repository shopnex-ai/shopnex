// What email does when another module says something happened. Loaded by the package entry, so any process that creates or changes
// an order through the API has it (api/tests/hooks.test.ts checks the listener is there once everything is loaded).
import { orderEvent } from '@shopnex/orders'
import { notify } from './notifications'

// Queues the emails an order event sends, inside the transaction that changed the order
orderEvent.on('email.notifications', (conn, { shopId, event, load }) => notify(conn, shopId, event, load))
