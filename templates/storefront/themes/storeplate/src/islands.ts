// React islands: <div data-island="Name" data-props='{…}'> in a template renders that component there, in the
// browser. For parts that only exist client-side (the cart); everything else is server-rendered Liquid.
import { createElement, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import CartButton from './islands/CartButton'
import CartDrawer from './islands/CartDrawer'

// Props come from the template (JSON), so they're not type-checked against the component
const islands = { CartButton, CartDrawer } as unknown as Record<string, ComponentType<Record<string, unknown>>>

for (const el of document.querySelectorAll<HTMLElement>('[data-island]')) {
  const Island = islands[el.dataset.island!]
  if (!Island) {
    console.warn(`[storeplate] unknown island: ${el.dataset.island}`)
    continue
  }
  const props = el.dataset.props ? (JSON.parse(el.dataset.props) as Record<string, unknown>) : {}
  createRoot(el).render(createElement(Island, props))
}
