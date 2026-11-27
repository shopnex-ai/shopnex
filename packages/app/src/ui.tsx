/** @jsxRuntime automatic @jsxImportSource hono/jsx */
// Server-rendered components (hono/jsx) that look like the ShopNex admin, for an app's embedded pages. No build
// step and no client framework: <Page> loads /shopnex/app.js (served by `shopnex.routes`), which connects to the
// admin and makes <Form action> and <Button action> call the app's backend with fresh session tokens.
//
//   app.get('/', async (c) => {
//     const { shop } = await shopnex.authenticate(c)
//     return c.html(
//       <Page title="My App">
//         <Card title={shop.name}>
//           <Button action="/api/refresh" reload>Refresh</Button>
//         </Card>
//       </Page>,
//     )
//   })
//
// Apps need "jsx": "react-jsx" and "jsxImportSource": "hono/jsx" in their tsconfig.
import { readFileSync } from 'node:fs'
import type { Child, PropsWithChildren } from 'hono/jsx'
import { raw } from 'hono/html'

type Tone = 'default' | 'subdued' | 'success' | 'warning' | 'critical'

// The admin's own colours (apps/admin-ui/src/styles.css), so an embedded page blends into the page around it. The
// admin sends its theme through the app bridge (data-theme, set by /shopnex/app.js); before that arrives, or when
// the page is opened on its own, the OS setting decides.
// Read once, then written into each page's <style>; a bundle (scripts/bundle-app.mjs) holds the text instead
const styles = readFileSync(new URL('./ui.css', import.meta.url), 'utf8')

/**
 * A whole embedded page: admin styles, and /shopnex/app.js (app bridge + Form/Button behaviour).
 * `actions` sit next to the title. `header={false}` leaves the title and subtitle out (the admin's top bar already
 * names the app); `title` is still the tab title.
 */
export function Page({
  title,
  subtitle,
  actions,
  header = true,
  children,
}: PropsWithChildren<{ title: string; subtitle?: string; actions?: Child; header?: boolean }>) {
  return (
    <>
      {raw('<!doctype html>')}
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{title}</title>
          <style>{raw(styles)}</style>
          <script type="module" src="/shopnex/app.js"></script>
        </head>
        <body>
          <main class="sx-page">
            {(header || actions) && (
              <header class="sx-page-head">
                <div>
                  {header && <h1>{title}</h1>}
                  {header && subtitle && <p class="sx-text sx-subdued">{subtitle}</p>}
                </div>
                {actions && (
                  <div class="sx-inline" style="gap:.5rem">
                    {actions}
                  </div>
                )}
              </header>
            )}
            <Stack gap={4}>{children}</Stack>
          </main>
        </body>
      </html>
    </>
  )
}

export function Card({ title, description, children }: PropsWithChildren<{ title?: string; description?: Child }>) {
  return (
    <section class="sx-card">
      {(title || description) && (
        <div class="sx-card-head">
          {title && <h2>{title}</h2>}
          {description && <p class="sx-text sx-subdued">{description}</p>}
        </div>
      )}
      <Stack gap={3}>{children}</Stack>
    </section>
  )
}

/** Vertical stack; `gap` in quarter rems (like Tailwind) */
export function Stack({ gap = 2, children }: PropsWithChildren<{ gap?: number }>) {
  return (
    <div class="sx-stack" style={`gap:${gap / 4}rem`}>
      {children}
    </div>
  )
}

/** A row that wraps */
export function Inline({
  gap = 2,
  justify,
  children,
}: PropsWithChildren<{ gap?: number; justify?: 'start' | 'end' | 'between' }>) {
  const j = justify === 'end' ? 'flex-end' : justify === 'between' ? 'space-between' : 'flex-start'
  return (
    <div class="sx-inline" style={`gap:${gap / 4}rem;justify-content:${j}`}>
      {children}
    </div>
  )
}

export function Text({
  tone = 'default',
  size,
  strong,
  children,
}: PropsWithChildren<{ tone?: Tone; size?: 'small'; strong?: boolean }>) {
  const cls = ['sx-text', tone !== 'default' && `sx-${tone}`, size && `sx-${size}`, strong && 'sx-strong']
  return <p class={cls.filter(Boolean).join(' ')}>{children}</p>
}

export function Badge({ tone = 'default', children }: PropsWithChildren<{ tone?: Tone }>) {
  return <span class={`sx-badge${tone === 'default' ? '' : ` sx-${tone}`}`}>{children}</span>
}

export function Banner({ tone = 'default', title, children }: PropsWithChildren<{ tone?: Tone; title?: string }>) {
  return (
    <div class={`sx-banner${tone === 'default' ? '' : ` sx-${tone}`}`} role={tone === 'critical' ? 'alert' : 'status'}>
      {title && <strong>{title}</strong>}
      {children && <div class="sx-subdued">{children}</div>}
    </div>
  )
}

/**
 * Settings that stay out of the way: one row each (title and a short summary of the current value), opening to the
 * content. Put them in <Disclosures>.
 */
export function Disclosures({ children }: PropsWithChildren) {
  return <div class="sx-disclosures">{children}</div>
}

export function Disclosure({
  title,
  summary,
  open,
  children,
}: PropsWithChildren<{ title: string; summary?: Child; open?: boolean }>) {
  return (
    <details class="sx-disclosure" open={open}>
      <summary>
        {title}
        {summary && <span>{summary}</span>}
      </summary>
      <div>{children}</div>
    </details>
  )
}

let filterIds = 0

/**
 * A list people can narrow down without a request: tabs (with counts), dropdown filters and a search box, then the
 * <FilterItem>s. It lives in a <Card> and its bar sticks to the top while the list scrolls. The tab and the filters are
 * kept in the URL hash, so they survive the reload that follows a <Button action reload>. One per page.
 *
 *   <Filterable tabs={[{ value: 'open', label: 'Open', count: 3, alert: true }, { value: 'all', label: 'All', count: 9 }]}
 *     defaultTab="open" filters={[{ name: 'rating', label: 'Any rating', options: [{ value: '5', label: '5 stars' }] }]}
 *     search="Search" noun="review">
 *     <FilterItem tab="open" values={{ rating: 5 }} text="the words search looks in">…</FilterItem>
 *   </Filterable>
 *
 * The tab `all` shows every item; any other tab shows the items whose `tab` is its value.
 */
export function Filterable({
  name,
  tabs,
  defaultTab,
  filters = [],
  search,
  noun = 'item',
  empty = 'Nothing here.',
  children,
}: PropsWithChildren<{
  /** Needed when the page has more than one list: each keeps its tab and filters under its own name */
  name?: string
  tabs: {
    value: string
    label: string
    count?: number
    /** Colour the count: something needs attention */ alert?: boolean
  }[]
  defaultTab: string
  filters?: { name: string; label: string; options: { value: string; label: string }[] }[]
  /** Placeholder of the search box; leave out for none */
  search?: string
  /** Singular, for "12 reviews" */
  noun?: string
  /** Shown when no item is in the chosen tab */
  empty?: string
}>) {
  const id = `sx-filter-${++filterIds}`
  const first = defaultTab.replace(/["\\]/g, '')
  return (
    <div id={id} data-sx-filter data-name={name} data-default-tab={defaultTab} data-noun={noun}>
      {/* Before the script runs, show only the default tab, so the page doesn't flash everything */}
      {defaultTab !== 'all' && (
        <style>{raw(`#${id}:not([data-ready]) [data-sx-item]:not([data-sx-tab="${first}"]){display:none}`)}</style>
      )}
      <div class="sx-filter-bar">
        <div class="sx-tabs">
          {tabs.map((tab) => (
            <button
              type="button"
              class={`sx-tab${tab.alert && tab.count ? ' sx-tab-alert' : ''}`}
              data-sx-tab-button={tab.value}
              aria-pressed="false"
            >
              {tab.label}
              {tab.count !== undefined && <b>{tab.count}</b>}
            </button>
          ))}
        </div>
        {filters.map((filter) => (
          <select class="sx-input" data-sx-select={filter.name} aria-label={filter.label}>
            <option value="">{filter.label}</option>
            {filter.options.map((o) => (
              <option value={o.value}>{o.label}</option>
            ))}
          </select>
        ))}
        {search && <input class="sx-input" type="search" placeholder={search} aria-label={search} data-sx-search />}
      </div>
      <p class="sx-text sx-subdued sx-small" style="margin:.75rem 0 0" data-sx-count></p>
      <p class="sx-text sx-subdued sx-empty" data-sx-empty data-empty={empty} hidden></p>
      {children}
    </div>
  )
}

/** One row of a <Filterable>: in `tab`, matching the filters named in `values`, found by `text` */
export function FilterItem({
  tab,
  values = {},
  text = '',
  children,
}: PropsWithChildren<{ tab: string; values?: Record<string, string | number>; text?: string }>) {
  const attrs = Object.fromEntries(Object.entries(values).map(([name, value]) => [`data-sx-f-${name}`, String(value)]))
  return (
    <div class="sx-item" data-sx-item data-sx-tab={tab} data-sx-text={text.toLowerCase()} {...attrs}>
      {children}
    </div>
  )
}

/**
 * The page's sections: a row of tabs and, for each, a <TabPanel> (anywhere in the page) that shows when its tab is chosen.
 * Nothing is requested; the chosen section stays in the URL hash, so it survives the reload after `<Button action reload>`.
 */
export function Tabs({
  tabs,
  defaultTab,
}: {
  tabs: {
    id: string
    label: string
    count?: number
    /** Colour the count: something needs attention */ alert?: boolean
  }[]
  defaultTab: string
}) {
  const first = defaultTab.replace(/["\\]/g, '')
  return (
    <>
      {/* Before the script runs, show only the default section, so the page doesn't flash all of them */}
      <style>
        {raw(
          `[data-sx-tabs]:not([data-ready])~* [data-sx-view]:not([data-sx-view="${first}"]),[data-sx-tabs]:not([data-ready])~[data-sx-view]:not([data-sx-view="${first}"]){display:none}`,
        )}
      </style>
      <nav class="sx-nav" role="tablist" data-sx-tabs data-default-tab={defaultTab}>
        {tabs.map((tab) => (
          <button
            type="button"
            role="tab"
            class={`sx-nav-tab${tab.alert && tab.count ? ' sx-nav-alert' : ''}`}
            data-sx-view-button={tab.id}
            aria-selected={String(tab.id === defaultTab)}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && <b>{tab.count}</b>}
          </button>
        ))}
      </nav>
    </>
  )
}

/** The content of one <Tabs> tab */
export function TabPanel({ id, children }: PropsWithChildren<{ id: string }>) {
  return (
    <div class="sx-view" role="tabpanel" data-sx-view={id}>
      <Stack gap={4}>{children}</Stack>
    </div>
  )
}

/** Hidden until a <Button toggles="id"> is pressed: a reply form, details, an edit form */
export function Panel({ id, open, children }: PropsWithChildren<{ id: string; open?: boolean }>) {
  return (
    <div id={id} class="sx-panel" data-sx-panel hidden={!open}>
      {children}
    </div>
  )
}

/** A number with a label */
export function Stat({ label, value }: { label: string; value: Child }) {
  return (
    <div class="sx-stat">
      <span class="sx-subdued sx-small">{label}</span>
      <span class="sx-stat-value">{value}</span>
    </div>
  )
}

type ActionProps = {
  /** POSTs to this path of the app's backend with a session token (Authorization: Bearer) */
  action?: string
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Reload the page after it succeeds */
  reload?: boolean
  /** Toast shown when it succeeds (default: the response's `message`) */
  success?: string
  /**
   * Asks first, in a dialog the admin draws (bridge.confirm): the title (or `{ title, message, label }`, label being the confirm button's text). The
   * call is made only when the person confirms; Cancel and Esc leave everything as it was.
   */
  confirm?: string | { title: string; message?: string; label?: string }
}

const actionAttrs = ({ action, method, reload, success, confirm }: ActionProps) => ({
  'data-shopnex-action': action,
  'data-method': method,
  'data-reload': reload ? '' : undefined,
  'data-success': success,
  'data-confirm-title': typeof confirm === 'string' ? confirm : confirm?.title,
  'data-confirm-message': typeof confirm === 'object' ? confirm.message : undefined,
  'data-confirm-label': typeof confirm === 'object' ? confirm.label : undefined,
})

/**
 * `action`: calls the app's backend (see ActionProps). `href`: a link styled as a button. Neither: a submit
 * button (inside <Form>).
 */
export function Button({
  variant = 'primary',
  href,
  external,
  children,
  ...props
}: PropsWithChildren<
  ActionProps & {
    variant?: 'primary' | 'secondary' | 'plain' | 'critical'
    href?: string
    external?: boolean
    /** Shows or hides the <Panel id> instead of calling the backend */
    toggles?: string
  }
>) {
  const cls = `sx-btn sx-btn-${variant}`
  if (props.toggles) {
    return (
      <button type="button" class={cls} data-sx-toggle={props.toggles}>
        {children}
      </button>
    )
  }
  if (href) {
    return (
      <a class={cls} href={href} {...(external && { target: '_blank', rel: 'noreferrer' })}>
        {children}
      </a>
    )
  }
  return props.action ? (
    <button type="button" class={cls} {...actionAttrs(props)}>
      {children}
    </button>
  ) : (
    <button type="submit" class={cls}>
      {children}
    </button>
  )
}

/**
 * Sends its fields as JSON to `action` on the app's backend (with a session token). Checkboxes are booleans.
 * Errors (`{ error }` with a 4xx/5xx) show at the bottom of the form.
 */
export function Form({ children, ...props }: PropsWithChildren<ActionProps & { action: string }>) {
  return (
    <form {...actionAttrs(props)}>
      <Stack gap={4}>
        {children}
        <p class="sx-text sx-critical sx-error" data-shopnex-error></p>
      </Stack>
    </form>
  )
}

let fieldIds = 0
const fieldId = (name: string) => `sx-${name}-${++fieldIds}`

type FieldProps = { label: string; name: string; help?: Child; required?: boolean }

export function TextField({
  label,
  name,
  help,
  required,
  type = 'text',
  value,
  placeholder,
  multiline,
  autocomplete,
}: FieldProps & {
  type?: 'text' | 'email' | 'url' | 'number' | 'password'
  value?: string | number | null
  placeholder?: string
  multiline?: boolean
  autocomplete?: string
}) {
  const id = fieldId(name)
  const input = multiline ? (
    <textarea id={id} name={name} class="sx-input" placeholder={placeholder} required={required}>
      {value ?? ''}
    </textarea>
  ) : (
    <input
      id={id}
      name={name}
      type={type}
      class="sx-input"
      value={value ?? undefined}
      placeholder={placeholder}
      required={required}
      autocomplete={autocomplete ?? (type === 'password' ? 'off' : undefined)}
    />
  )
  return (
    <div class="sx-field">
      <label for={id}>{label}</label>
      {input}
      {help && <p class="sx-text sx-subdued sx-small">{help}</p>}
    </div>
  )
}

export function Select({
  label,
  name,
  help,
  required,
  value,
  options,
}: FieldProps & { value?: string; options: { value: string; label: string }[] }) {
  const id = fieldId(name)
  return (
    <div class="sx-field">
      <label for={id}>{label}</label>
      <select id={id} name={name} class="sx-input" required={required}>
        {options.map((o) => (
          <option value={o.value} selected={o.value === value}>
            {o.label}
          </option>
        ))}
      </select>
      {help && <p class="sx-text sx-subdued sx-small">{help}</p>}
    </div>
  )
}

export function Checkbox({ label, name, help, checked }: Omit<FieldProps, 'required'> & { checked?: boolean }) {
  const id = fieldId(name)
  return (
    <div class="sx-field">
      <label class="sx-check" for={id}>
        <input id={id} name={name} type="checkbox" checked={checked} />
        {label}
      </label>
      {help && <p class="sx-text sx-subdued sx-small">{help}</p>}
    </div>
  )
}

export function Code({ children }: PropsWithChildren) {
  return <code class="sx-code">{children}</code>
}

/** A command or value that copies itself when clicked (the hint reads "Copied" for a moment) */
export function CopyableCode({ value }: { value: string }) {
  return (
    <button type="button" class="sx-cmd" data-shopnex-copy={value} title="Click to copy">
      <code class="sx-code">{value}</code>
    </button>
  )
}
