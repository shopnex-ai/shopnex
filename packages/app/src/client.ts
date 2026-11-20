// The browser side of the UI components, served at /shopnex/app.js (plain JS, no build step). Connects to the
// admin (window.shopnex is the app bridge) and wires the declarative attributes the components render:
//   <form data-shopnex-action="/api/settings">   JSON body → authenticatedFetch
//   <button data-shopnex-action="/api/refresh">  POST → authenticatedFetch
//   <button data-shopnex-copy="text">         copies the text to the clipboard (see CopyableCode)
//   data-reload        reload the page on success (with a fresh session token)
//   data-success="…"   toast on success (default: the response's `message`)
//   data-sx-filter     <Filterable>: tabs, dropdown filters and search narrow the <FilterItem>s in the page (state in the URL hash)
//   data-sx-toggle=id  <Button toggles>: shows or hides the <Panel id>
//   data-confirm="…"   needs a second click within 4 seconds; the first one shows this text on the button
// The response may carry { message, redirect }. Errors show in the form's [data-shopnex-error] and as a toast.
export const clientScript = /* js */ `
import { createAppBridge } from './app-bridge.js'

const bridge = createAppBridge()
window.shopnex = bridge

// Look like the admin around the iframe: its theme (not the OS setting), now and when it changes
const applyTheme = (theme) => (document.documentElement.dataset.theme = theme)
bridge.getTheme().then(applyTheme).catch(() => {})
bridge.onThemeChange(applyTheme)

// The page URL's session token expires in a minute: reload with a fresh one
bridge.reload = async () => {
  const url = new URL(location.href)
  url.searchParams.set('session_token', await bridge.getSessionToken())
  location.replace(url)
}

async function run(el, init) {
  const busy = el.matches('form') ? el.querySelectorAll('button, input, select, textarea') : [el]
  const error = el.querySelector?.('[data-shopnex-error]')
  if (error) error.textContent = ''
  busy.forEach((b) => (b.disabled = true))
  try {
    const res = await bridge.authenticatedFetch(el.dataset.shopnexAction, init)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error ?? body.message ?? 'Something went wrong')
    const message = el.dataset.success ?? body.message
    if (message) await bridge.toast(message)
    if (body.redirect) return bridge.redirect(body.redirect)
    if (el.dataset.reload !== undefined) return bridge.reload()
    el.dispatchEvent(new CustomEvent('shopnex:done', { detail: body, bubbles: true }))
  } catch (e) {
    const message = e?.message ?? String(e)
    if (error) error.textContent = message
    else await bridge.toast(message, { isError: true })
  } finally {
    busy.forEach((b) => (b.disabled = false))
  }
}

// Capture phase, so the first click of a button that asks for confirmation never reaches the handlers below
document.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-confirm]')
  if (!button) return
  if (button.classList.contains('sx-armed')) {
    clearTimeout(button.confirmTimer)
    button.classList.remove('sx-armed')
    button.textContent = button.dataset.label
    return
  }
  event.preventDefault()
  event.stopImmediatePropagation()
  button.dataset.label = button.textContent
  button.textContent = button.dataset.confirm
  button.classList.add('sx-armed')
  button.confirmTimer = setTimeout(() => {
    button.classList.remove('sx-armed')
    button.textContent = button.dataset.label
  }, 4000)
}, true)

document.addEventListener('submit', (event) => {
  const form = event.target.closest('form[data-shopnex-action]')
  if (!form) return
  event.preventDefault()
  const body = {}
  for (const [key, value] of new FormData(form)) body[key] = value
  for (const box of form.querySelectorAll('input[type=checkbox][name]')) body[box.name] = box.checked
  run(form, {
    method: form.dataset.method ?? 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
})

document.addEventListener('click', (event) => {
  // Rendered type="button", so never a form's submit
  const button = event.target.closest('button[data-shopnex-action]')
  if (!button) return
  event.preventDefault()
  run(button, { method: button.dataset.method ?? 'POST' })
})

document.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-shopnex-copy]')
  if (!button) return
  const value = button.dataset.shopnexCopy
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
  const hint = button.querySelector('.sx-cmd-hint') ?? button
  const label = hint.dataset.label ??= hint.textContent
  hint.textContent = 'Copied'
  setTimeout(() => (hint.textContent = label), 1500)
})

// <Filterable>: nothing is requested, items are shown or hidden. The tab and the filters live in the URL hash (the page
// reloads with a new session token after an action, and keeps the hash).
for (const root of document.querySelectorAll('[data-sx-filter]')) {
  const items = [...root.querySelectorAll('[data-sx-item]')]
  const tabs = [...root.querySelectorAll('[data-sx-tab-button]')]
  const selects = [...root.querySelectorAll('[data-sx-select]')]
  const search = root.querySelector('[data-sx-search]')
  const empty = root.querySelector('[data-sx-empty]')
  const count = root.querySelector('[data-sx-count]')
  const first = root.dataset.defaultTab
  const noun = root.dataset.noun

  const saved = new URLSearchParams(location.hash.slice(1))
  let tab = saved.get('tab') ?? first
  if (!tabs.some((t) => t.dataset.sxTabButton === tab)) tab = first
  for (const select of selects) select.value = saved.get(select.dataset.sxSelect) ?? ''

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
      empty.textContent = narrowed ? 'Nothing matches these filters.' : empty.dataset.empty
    }
    if (count) count.textContent = shown + ' ' + noun + (shown === 1 ? '' : 's')
    const next = new URLSearchParams()
    if (tab !== first) next.set('tab', tab)
    for (const s of selects) if (s.value) next.set(s.dataset.sxSelect, s.value)
    history.replaceState(null, '', location.pathname + location.search + (next.size ? '#' + next : ''))
  }

  for (const t of tabs) t.addEventListener('click', () => ((tab = t.dataset.sxTabButton), apply()))
  for (const s of selects) s.addEventListener('change', apply)
  search?.addEventListener('input', apply)
  apply()
  root.dataset.ready = ''
}

// <Button toggles="id">: shows or hides the <Panel id>, and puts the cursor in its first field
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-sx-toggle]')
  const panel = button && document.getElementById(button.dataset.sxToggle)
  if (!panel) return
  panel.hidden = !panel.hidden
  if (!panel.hidden) panel.querySelector('input, textarea, select')?.focus()
})
`
