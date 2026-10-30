// The browser side of the UI components, served at /shopnex/app.js (plain JS, no build step). Connects to the
// admin (window.shopnex is the app bridge) and wires the declarative attributes the components render:
//   <form data-shopnex-action="/api/settings">   JSON body → authenticatedFetch
//   <button data-shopnex-action="/api/refresh">  POST → authenticatedFetch
//   <button data-shopnex-copy="text">         copies the text to the clipboard (see CopyableCode)
//   data-reload        reload the page on success (with a fresh session token)
//   data-success="…"   toast on success (default: the response's `message`)
// The response may carry { message, redirect }. Errors show in the form's [data-shopnex-error] and as a toast.
export const clientScript = /* js */ `
import { createAppBridge } from './app-bridge.js'

const bridge = createAppBridge()
window.shopnex = bridge

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
  const label = button.dataset.label ??= button.textContent
  button.textContent = 'Copied'
  setTimeout(() => (button.textContent = label), 1500)
})
`
