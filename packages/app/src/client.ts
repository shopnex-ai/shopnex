// The browser side of the UI components, served at /shopnex/app.js (TypeScript, compiled to plain JS when the app starts: see index.ts; no build step). Connects to the
// admin (window.shopnex is the app bridge) and wires the declarative attributes the components render:
//   <form data-shopnex-action="/api/settings">   JSON body → authenticatedFetch
//   <button data-shopnex-action="/api/refresh">  POST → authenticatedFetch
//   <button data-shopnex-copy="text">         copies the text to the clipboard (see CopyableCode)
//   data-reload        reload the page on success (with a fresh session token)
//   data-success="…"   toast on success (default: the response's `message`)
//   data-sx-filter     <Filterable>: tabs, dropdown filters and search narrow the <FilterItem>s in the page (state in the URL hash)
//   data-sx-tabs       <Tabs>: shows one <TabPanel> of the page at a time (state in the URL hash, key "view")
//   data-sx-toggle=id  <Button toggles>: shows or hides the <Panel id>
//   data-confirm-title (+ -message, -label)   the admin asks first, in a dialog (bridge.confirm); Cancel does nothing
// The response may carry { message, redirect }. Errors show in the form's [data-shopnex-error] and as a toast.
import { createAppBridge } from './app-bridge.js'
import type { Theme } from '@shopnex/app-bridge'

// What the script finds by selector or event is typed Element/EventTarget, which have no `dataset` or `hidden`
const all = <T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string) => [
  ...root.querySelectorAll<T>(selector),
]
const one = <T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string) => root.querySelector<T>(selector)
/** The element an event came from, or its closest ancestor matching `selector` */
const closest = <T extends HTMLElement = HTMLElement>(event: Event, selector: string) =>
  event.target instanceof Element ? event.target.closest<T>(selector) : null

const base = createAppBridge()
// The page URL's session token expires in a minute: reload with a fresh one
const bridge = Object.assign(base, {
  async reload() {
    const url = new URL(location.href)
    url.searchParams.set('session_token', await base.getSessionToken())
    location.replace(url)
  },
})
Object.assign(window, { shopnex: bridge })

// Look like the admin around the iframe: its theme (not the OS setting), now and when it changes
const applyTheme = (theme: Theme) => {
  document.documentElement.dataset.theme = theme
}
bridge
  .getTheme()
  .then(applyTheme)
  .catch(() => {})
bridge.onThemeChange(applyTheme)

// <Button confirm>: the admin asks in its own dialog (bridge.confirm). An admin too old to know it falls back to the browser's
async function confirmed(el: HTMLElement) {
  const title = el.dataset.confirmTitle
  if (!title) return true
  const options = { title, message: el.dataset.confirmMessage, label: el.dataset.confirmLabel }
  try {
    return await bridge.confirm(options)
  } catch {
    return window.confirm(options.message ? title + '\n\n' + options.message : title)
  }
}

type Control = HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

async function run(el: HTMLElement, init: RequestInit) {
  const busy = el.matches('form') ? all<Control>(el, 'button, input, select, textarea') : [el as Control]
  const error = one(el, '[data-shopnex-error]')
  if (error) error.textContent = ''
  busy.forEach((b) => (b.disabled = true))
  try {
    const res = await bridge.authenticatedFetch(String(el.dataset.shopnexAction), init)
    const body: { error?: string; message?: string; redirect?: string } = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error ?? body.message ?? 'Something went wrong')
    const message = el.dataset.success ?? body.message
    if (message) await bridge.toast(message)
    if (body.redirect) return bridge.redirect(body.redirect)
    if (el.dataset.reload !== undefined) return bridge.reload()
    el.dispatchEvent(new CustomEvent('shopnex:done', { detail: body, bubbles: true }))
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (error) error.textContent = message
    else await bridge.toast(message, { isError: true })
  } finally {
    busy.forEach((b) => (b.disabled = false))
  }
}

document.addEventListener('submit', async (event) => {
  const form = closest<HTMLFormElement>(event, 'form[data-shopnex-action]')
  if (!form) return
  event.preventDefault()
  if (!(await confirmed(form))) return
  const body: Record<string, FormDataEntryValue | boolean> = {}
  for (const [key, value] of new FormData(form)) body[key] = value
  for (const box of all<HTMLInputElement>(form, 'input[type=checkbox][name]')) body[box.name] = box.checked
  void run(form, {
    method: form.dataset.method ?? 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
})

document.addEventListener('click', async (event) => {
  // Rendered type="button", so never a form's submit
  const button = closest(event, 'button[data-shopnex-action]')
  if (!button) return
  event.preventDefault()
  if (!(await confirmed(button))) return
  void run(button, { method: button.dataset.method ?? 'POST' })
})

document.addEventListener('click', async (event) => {
  const button = closest(event, 'button[data-shopnex-copy]')
  if (!button) return
  const value = button.dataset.shopnexCopy ?? ''
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    // Clipboard API refused (no permission, or an insecure origin): fall back to selecting a temporary field
    const field = document.createElement('textarea')
    field.value = value
    document.body.append(field)
    field.select()
    document.execCommand('copy')
    field.remove()
  }
  const hint = one(button, '.sx-cmd-hint') ?? button
  const label = (hint.dataset.label ??= hint.textContent ?? '')
  hint.textContent = 'Copied'
  setTimeout(() => (hint.textContent = label), 1500)
})

// The page's own state (the section, the tab and filters of each list) lives in the URL hash: the page reloads with a new
// session token after an action, and keeps the hash. Each component writes only its own keys.
const saveHash = (updates: Record<string, string>) => {
  const next = new URLSearchParams(location.hash.slice(1))
  for (const [key, value] of Object.entries(updates)) {
    if (value) next.set(key, value)
    else next.delete(key)
  }
  history.replaceState(null, '', location.pathname + location.search + (next.size ? '#' + next : ''))
}

// <Tabs>: the page's sections. Nothing is requested, panels are shown or hidden.
for (const root of all(document, '[data-sx-tabs]')) {
  const buttons = all(root, '[data-sx-view-button]')
  const panels = all(document, '[data-sx-view]')
  const first = root.dataset.defaultTab ?? ''
  let view = new URLSearchParams(location.hash.slice(1)).get('view') ?? first
  if (!buttons.some((b) => b.dataset.sxViewButton === view)) view = first

  const apply = () => {
    for (const b of buttons) b.setAttribute('aria-selected', String(b.dataset.sxViewButton === view))
    for (const p of panels) p.hidden = p.dataset.sxView !== view
    saveHash({ view: view === first ? '' : view })
  }
  for (const b of buttons) {
    b.addEventListener('click', () => {
      view = b.dataset.sxViewButton ?? first
      apply()
    })
  }
  apply()
  root.dataset.ready = ''
}

// <Filterable>: nothing is requested, items are shown or hidden. A list with a name keeps its state under "name.tab"
// and "name.filter", so several lists fit on one page.
for (const root of all(document, '[data-sx-filter]')) {
  const items = all(root, '[data-sx-item]')
  const tabs = all(root, '[data-sx-tab-button]')
  const selects = all<HTMLSelectElement>(root, '[data-sx-select]')
  const search = one<HTMLInputElement>(root, '[data-sx-search]')
  const empty = one(root, '[data-sx-empty]')
  const count = one(root, '[data-sx-count]')
  const first = root.dataset.defaultTab ?? ''
  const noun = root.dataset.noun ?? 'item'
  const prefix = root.dataset.name ? root.dataset.name + '.' : ''

  const saved = new URLSearchParams(location.hash.slice(1))
  let tab = saved.get(prefix + 'tab') ?? first
  if (!tabs.some((t) => t.dataset.sxTabButton === tab)) tab = first
  for (const select of selects) select.value = saved.get(prefix + select.dataset.sxSelect) ?? ''

  const apply = () => {
    const words = (search?.value ?? '').trim().toLowerCase()
    let shown = 0
    for (const item of items) {
      const ok =
        (tab === 'all' || item.dataset.sxTab === tab) &&
        selects.every((s) => !s.value || item.getAttribute('data-sx-f-' + s.dataset.sxSelect) === s.value) &&
        (!words || (item.dataset.sxText ?? '').includes(words))
      item.hidden = !ok
      if (ok) shown++
    }
    for (const t of tabs) t.setAttribute('aria-pressed', String(t.dataset.sxTabButton === tab))
    const narrowed = selects.some((s) => s.value) || words
    if (empty) {
      empty.hidden = shown > 0
      empty.textContent = narrowed ? 'Nothing matches these filters.' : (empty.dataset.empty ?? '')
    }
    if (count) count.textContent = shown + ' ' + noun + (shown === 1 ? '' : 's')
    const state: Record<string, string> = { [prefix + 'tab']: tab !== first ? tab : '' }
    for (const s of selects) state[prefix + s.dataset.sxSelect] = s.value
    saveHash(state)
  }

  for (const t of tabs) {
    t.addEventListener('click', () => {
      tab = t.dataset.sxTabButton ?? first
      apply()
    })
  }
  for (const s of selects) s.addEventListener('change', apply)
  search?.addEventListener('input', apply)
  apply()
  root.dataset.ready = ''
}

// <Button toggles="id">: shows or hides the <Panel id>, and puts the cursor in its first field
document.addEventListener('click', (event) => {
  const id = closest(event, '[data-sx-toggle]')?.dataset.sxToggle
  const panel = id ? document.getElementById(id) : null
  if (!panel) return
  panel.hidden = !panel.hidden
  if (!panel.hidden) one(panel, 'input, textarea, select')?.focus()
})
