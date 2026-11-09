import defaultMdxComponents from 'fumadocs-ui/mdx'
import type { MDXComponents } from 'mdx/types'
import { Scopes, WebhookDelivery, WebhookPayloads, WebhookTopics } from './components/reference'

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return { ...defaultMdxComponents, Scopes, WebhookTopics, WebhookPayloads, WebhookDelivery, ...components }
}
