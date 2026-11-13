import defaultMdxComponents from 'fumadocs-ui/mdx'
import type { MDXComponents } from 'mdx/types'
import { CopyCommand } from './components/copy-command'
import { Home } from './components/home'
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
    CopyCommand,
    EnvVars,
    Home,
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
