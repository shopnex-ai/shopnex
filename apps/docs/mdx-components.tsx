import defaultMdxComponents from 'fumadocs-ui/mdx'
import type { MDXComponents } from 'mdx/types'
import {
  EnvVars,
  Modules,
  Roles,
  Scopes,
  Value,
  WebhookDelivery,
  WebhookPayloads,
  WebhookTopics,
} from './components/reference'

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    EnvVars,
    Modules,
    Roles,
    Scopes,
    Value,
    WebhookTopics,
    WebhookPayloads,
    WebhookDelivery,
    ...components,
  }
}
