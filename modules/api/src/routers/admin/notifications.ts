import { notificationService } from '@shopnex/email'
import { shopManager } from '../../orpc'
import { notificationParam, templateInput, templatePatchInput } from './schemas'

// Settings → Notifications: the Liquid of the emails Shopnex sends (order confirmation, shipping…), with a
// preview, a test send and the recent emails. Owners and admins only.
export const notifications = {
  list: shopManager
    .route({ method: 'GET', path: '/admin/notifications' })
    .handler(({ context }) => notificationService.list(context.shop.id)),
  // Declared before {notification} so the path isn't read as a notification name
  deliveries: shopManager
    .route({ method: 'GET', path: '/admin/notifications/deliveries' })
    .handler(({ context }) => notificationService.deliveries(context.shop.id)),
  get: shopManager
    .route({ method: 'GET', path: '/admin/notifications/{notification}' })
    .input(notificationParam)
    .handler(({ input, context }) => notificationService.get(context.shop.id, input.notification)),
  // Liquid with a syntax error is refused (the message names the line)
  update: shopManager
    .route({ method: 'PATCH', path: '/admin/notifications/{notification}' })
    .input(notificationParam.extend(templatePatchInput.shape))
    .handler(({ input: { notification, ...patch }, context }) =>
      notificationService.update(context.shop.id, notification, patch),
    ),
  revert: shopManager
    .route({ method: 'POST', path: '/admin/notifications/{notification}/revert' })
    .input(notificationParam)
    .handler(({ input, context }) => notificationService.revert(context.shop.id, input.notification)),
  // Renders unsaved Liquid with the shop's latest order (or a sample); errors come back in `problem`
  preview: shopManager
    .route({ method: 'POST', path: '/admin/notifications/{notification}/preview' })
    .input(notificationParam.extend(templateInput.shape))
    .handler(({ input: { notification, ...source }, context }) =>
      notificationService.preview(context.shop.id, notification, source),
    ),
  // Sends the preview to the signed-in staff member
  test: shopManager
    .route({ method: 'POST', path: '/admin/notifications/{notification}/test' })
    .input(notificationParam.extend(templateInput.shape))
    .handler(({ input: { notification, ...source }, context }) =>
      notificationService.sendTest(context.shop.id, notification, source, context.user.email),
    ),
}
