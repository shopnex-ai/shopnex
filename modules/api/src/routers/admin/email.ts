import { emailService } from '@shopnex/email'
import { shopManager } from '../../orpc'
import { emailInput, smtpInput } from './schemas'

// Settings → Email: how the shop sends email (off, or an SMTP server). Owners and admins only; the password
// is write-only.
export const email = {
  get: shopManager
    .route({ method: 'GET', path: '/admin/email' })
    .handler(({ context }) => emailService.getSettings(context.shop.id)),
  // Turning SMTP on checks the login first and fails if the server refuses it
  update: shopManager
    .route({ method: 'PUT', path: '/admin/email' })
    .input(emailInput)
    .handler(({ input, context }) =>
      input.provider === 'off'
        ? emailService.turnOff(context.shop.id)
        : emailService.useSmtp(context.shop.id, { ...input.smtp, password: input.smtp.password || undefined }),
    ),
  // Logs in and sends a test message to the signed-in staff member, without saving anything
  test: shopManager
    .route({ method: 'POST', path: '/admin/email/test' })
    .input(smtpInput)
    .handler(({ input, context }) =>
      emailService.test(context.shop.id, { ...input, password: input.password || undefined }, context.user.email),
    ),
}
