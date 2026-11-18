import { z } from 'zod'
import { createProcedures } from '@shopnex/rpc'
import {
  abandonedCartSettingsInput,
  abandonedCartSettingsOutput,
  emailInput,
  emailSettingsOutput,
  notificationDeliveryOutput,
  notificationListItemOutput,
  notificationOutput,
  notificationParam,
  notificationPreviewOutput,
  notificationTestOutput,
  smtpInput,
  templateInput,
  templatePatchInput,
  testResultOutput,
} from './email.contract'
import * as abandonedCartService from './abandoned-settings'
import * as emailService from './email'
import * as notificationService from './notifications'

const { shopManager } = createProcedures()

// Settings → Email: how the shop sends email (off, or an SMTP server). Owners and admins only; the password
// is write-only.
export const email = {
  get: shopManager
    .route({ method: 'GET', path: '/admin/email' })
    .output(emailSettingsOutput)
    .handler(({ context }) => emailService.getSettings(context.shop.id)),
  // Turning SMTP on checks the login first and fails if the server refuses it
  update: shopManager
    .route({ method: 'PUT', path: '/admin/email' })
    .output(emailSettingsOutput)
    .input(emailInput)
    .handler(({ input, context }) =>
      input.provider === 'off'
        ? emailService.turnOff(context.shop.id)
        : emailService.useSmtp(context.shop.id, { ...input.smtp, password: input.smtp.password || undefined }),
    ),
  // Logs in and sends a test message to the signed-in staff member, without saving anything
  test: shopManager
    .route({ method: 'POST', path: '/admin/email/test' })
    .output(testResultOutput)
    .input(smtpInput)
    .handler(({ input, context }) =>
      emailService.test(context.shop.id, { ...input, password: input.password || undefined }, context.user.email),
    ),
}

// Settings → Notifications: the Liquid of the emails ShopNex sends (order confirmation, shipping…), with a
// preview, a test send and the recent emails. Owners and admins only.
export const notifications = {
  list: shopManager
    .route({ method: 'GET', path: '/admin/notifications' })
    .output(z.array(notificationListItemOutput))
    .handler(({ context }) => notificationService.list(context.shop.id)),
  // Declared before {notification} so the path isn't read as a notification name
  deliveries: shopManager
    .route({ method: 'GET', path: '/admin/notifications/deliveries' })
    .output(z.array(notificationDeliveryOutput))
    .handler(({ context }) => notificationService.deliveries(context.shop.id)),
  // Abandoned cart emails: the switch and how long to wait. Declared before {notification} like deliveries
  abandonedCartSettings: shopManager
    .route({ method: 'GET', path: '/admin/notifications/abandoned-cart/settings' })
    .output(abandonedCartSettingsOutput)
    .handler(async ({ context }) => ({
      ...(await abandonedCartService.getSettings(context.shop.id)),
      emailOn: (await emailService.getSettings(context.shop.id)).provider !== 'off',
    })),
  updateAbandonedCartSettings: shopManager
    .route({ method: 'PATCH', path: '/admin/notifications/abandoned-cart/settings' })
    .output(abandonedCartSettingsOutput)
    .input(abandonedCartSettingsInput)
    .handler(async ({ input, context }) => ({
      ...(await abandonedCartService.updateSettings(context.shop.id, input)),
      emailOn: (await emailService.getSettings(context.shop.id)).provider !== 'off',
    })),
  get: shopManager
    .route({ method: 'GET', path: '/admin/notifications/{notification}' })
    .output(notificationOutput)
    .input(notificationParam)
    .handler(({ input, context }) => notificationService.get(context.shop.id, input.notification)),
  // Liquid with a syntax error is refused (the message names the line)
  update: shopManager
    .route({ method: 'PATCH', path: '/admin/notifications/{notification}' })
    .output(notificationOutput)
    .input(notificationParam.extend(templatePatchInput.shape))
    .handler(({ input: { notification, ...patch }, context }) =>
      notificationService.update(context.shop.id, notification, patch),
    ),
  revert: shopManager
    .route({ method: 'POST', path: '/admin/notifications/{notification}/revert' })
    .output(notificationOutput)
    .input(notificationParam)
    .handler(({ input, context }) => notificationService.revert(context.shop.id, input.notification)),
  // Renders unsaved Liquid with the shop's latest order (or a sample); errors come back in `problem`
  preview: shopManager
    .route({ method: 'POST', path: '/admin/notifications/{notification}/preview' })
    .output(notificationPreviewOutput)
    .input(notificationParam.extend(templateInput.shape))
    .handler(({ input: { notification, ...source }, context }) =>
      notificationService.preview(context.shop.id, notification, source),
    ),
  // Sends the preview to the signed-in staff member
  test: shopManager
    .route({ method: 'POST', path: '/admin/notifications/{notification}/test' })
    .output(notificationTestOutput)
    .input(notificationParam.extend(templateInput.shape))
    .handler(({ input: { notification, ...source }, context }) =>
      notificationService.sendTest(context.shop.id, notification, source, context.user.email),
    ),
}
