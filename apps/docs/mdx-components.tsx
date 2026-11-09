import defaultMdxComponents from 'fumadocs-ui/mdx'
import type { MDXComponents } from 'mdx/types'
import { EnvVars, Roles, Scopes, WebhookDelivery, WebhookPayloads, WebhookTopics } from './components/reference'

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    EnvVars,
    Roles,
    Scopes,
    WebhookTopics,
    WebhookPayloads,
    WebhookDelivery,
    ...components,
  }
}
