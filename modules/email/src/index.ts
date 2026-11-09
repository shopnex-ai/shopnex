export * as emailService from './email'
export * as notificationService from './notifications'
export type { EmailMessage, SmtpInput, TestStep } from './email'
export {
  LOGIN_CODE_MINUTES,
  notify,
  sendLoginCode,
  type OrderEvent,
  type OrderView,
  type TemplateInput,
} from './notifications'
export { startEmailWorker } from './worker'
export { queueDue as queueAbandonedCartEmails } from './abandoned-carts'
export * as abandonedCartService from './abandoned-settings'
export { EmailError, type EmailErrorCode } from './errors'
export { checkLiquid, type LiquidProblem } from './liquid'
export { NOTIFICATIONS, SMTP_PRESETS, type Notification, type SmtpConfig, type SmtpPreset } from '@shopnex/db/schema'
