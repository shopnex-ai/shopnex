// The merchant's connector (Stripe, Adyen…) as Hyperswitch Prism wants it. Prism is one API over many processors:
// only the credentials differ, so a connector is a name plus the fields its config takes.
import { PaymentClient, types } from 'hyperswitch-prism'

import { CONNECTORS } from './connectors.generated'

export { CONNECTORS }
export type ConnectorId = string
export const isConnector = (id: unknown): id is ConnectorId => typeof id === 'string' && Object.hasOwn(CONNECTORS, id)

/** What the merchant saved: the connector and test mode are plain settings, the credential values are secret */
export type Credentials = { connector: ConnectorId; testMode: boolean; values: Record<string, string> }

/** What a processor's form asks for: its required fields, then the optional ones (all optional when unknown) */
export function fieldsOf(connector: ConnectorId) {
  const { required, secrets, options } = CONNECTORS[connector]!
  const all = [...secrets, ...options]
  const must = required ?? []
  return [
    ...must.map((name) => ({ name, optional: false })),
    ...all.filter((f) => !must.includes(f)).map((name) => ({ name, optional: true })),
  ]
}

/** All field names across processors, in a stable order (the form has one input per name) */
export const allFields = [...new Set(Object.keys(CONNECTORS).flatMap((id) => fieldsOf(id).map((f) => f.name)))]

/** "apiKey" → "API key", "merchantAccountId" → "Merchant account id" */
export const fieldLabel = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/^api\b/, 'API')
    .replace(/\burl\b/g, 'URL')
    .replace(/\bid\b/g, 'ID')
    .replace(/^./, (c) => c.toUpperCase())

/** Names the required fields still missing, or null */
export function missingFields(connector: ConnectorId, values: Record<string, string>) {
  const missing = (CONNECTORS[connector]!.required ?? []).filter((f) => !values[f])
  return missing.length ? `Enter ${missing.map(fieldLabel).join(', ')}` : null
}

/**
 * Asks Prism whether it accepts these credentials, without sending anything: it checks a config before it talks to
 * anyone, and the request here goes to a dead local port. Covers what the generated `required` can't (processors
 * where which fields are needed depend on each other). Returns why not, or null.
 */
export async function checkCredentials(credentials: Credentials): Promise<string | null> {
  const dead = 'http://127.0.0.1:9/'
  const { label, secrets, options } = CONNECTORS[credentials.connector]!
  const config = connectorConfig(credentials) as unknown as { connectorConfig: Record<string, Record<string, unknown>> }
  const entry = config.connectorConfig[credentials.connector]!
  for (const field of ['baseUrl', ...options]) if (field === 'baseUrl' || field in entry) entry[field] = dead
  try {
    await new PaymentClient(config as unknown as types.ConnectorConfig).authorize({
      merchantTransactionId: 'credentials-check',
      amount: { minorAmount: 1000, currency: types.Currency.USD },
      captureMethod: types.CaptureMethod.AUTOMATIC,
      paymentMethod: {
        card: {
          cardNumber: { value: '4111111111111111' },
          cardExpMonth: { value: '12' },
          cardExpYear: { value: '2030' },
          cardCvc: { value: '123' },
          cardHolderName: { value: 'Test' },
        },
      },
      address: { billingAddress: {} },
      authType: types.AuthenticationType.NO_THREE_DS,
      returnUrl: 'https://example.com/return',
      testMode: true,
    })
  } catch (error) {
    if ((error as { errorCode?: string })?.errorCode === 'FAILED_TO_OBTAIN_AUTH_TYPE') {
      return `${label} didn't accept these credentials: some are missing (it takes ${[...secrets, ...options].map(fieldLabel).join(', ')})`
    }
  }
  return null
}

/** Secrets go in as Prism's SecretString, plain settings (base URLs…) as they are; fields left empty are omitted */
export function connectorConfig({ connector, values }: Credentials): types.ConnectorConfig {
  const { secrets } = CONNECTORS[connector]!
  const entry = Object.fromEntries(
    Object.entries(values).map(([field, value]) => [field, secrets.includes(field) ? { value } : value]),
  )
  return { connectorConfig: { [connector]: entry } } as types.ConnectorConfig
}

export const currencyOf = (code: string) => types.Currency[code.toUpperCase() as keyof typeof types.Currency]

// Declined, failed or expired: nothing was charged
const failed: number[] = [
  types.PaymentStatus.FAILURE,
  types.PaymentStatus.AUTHORIZATION_FAILED,
  types.PaymentStatus.AUTHENTICATION_FAILED,
  types.PaymentStatus.ROUTER_DECLINED,
  types.PaymentStatus.EXPIRED,
]
export const outcomeOf = (status: number | null | undefined) =>
  status === types.PaymentStatus.CHARGED
    ? ('paid' as const)
    : failed.includes(status ?? -1)
      ? ('failed' as const)
      : ('pending' as const)

/** Why Prism says a payment or refund failed, in the most buyer-friendly words it has */
export const errorText = (error: types.IErrorInfo | null | undefined, fallback: string) =>
  error?.unifiedDetails?.userGuidanceMessage ||
  error?.unifiedDetails?.message ||
  error?.issuerDetails?.message ||
  error?.connectorDetails?.message ||
  fallback
