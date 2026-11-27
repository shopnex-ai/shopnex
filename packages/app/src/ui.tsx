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
import type { Child, PropsWithChildren } from 'hono/jsx'
import { raw } from 'hono/html'

type Tone = 'default' | 'subdued' | 'success' | 'warning' | 'critical'

// The admin's own colours (apps/admin-ui/src/styles.css), so an embedded page blends into the page around it. The
// admin sends its theme through the app bridge (data-theme, set by /shopnex/app.js); before that arrives, or when
// the page is opened on its own, the OS setting decides.
const light = `--bg:oklch(.982 .002 95);--fg:oklch(.18 .005 95);--card:oklch(1 0 0);--muted:oklch(.955 .003 95);
--muted-fg:oklch(.52 .008 95);--border:oklch(.915 .004 95);--primary:oklch(.22 .006 95);--primary-fg:oklch(.985 .002 95);
--critical:oklch(.577 .245 27.325);--success:oklch(.52 .14 150);--warning:oklch(.62 .15 70);--ring:oklch(.6 .15 155)`
const dark = `--bg:oklch(.165 .003 95);--fg:oklch(.97 .002 95);--card:oklch(.205 .004 95);--muted:oklch(.27 .005 95);
--muted-fg:oklch(.71 .006 95);--border:oklch(1 0 0/9%);--primary:oklch(.95 .003 95);--primary-fg:oklch(.2 .005 95);
--critical:oklch(.704 .191 22.216);--success:oklch(.72 .15 150);--warning:oklch(.8 .14 80);--ring:oklch(.7 .15 155)`

const styles = `
:root{color-scheme:light dark;${light};--radius:.625rem}
:root[data-theme=light]{color-scheme:light}
:root[data-theme=dark]{color-scheme:dark;${dark}}
@media (prefers-color-scheme:dark){:root:not([data-theme]){${dark}}}
*{box-sizing:border-box}
body{margin:0;font:14px/1.5 ui-sans-serif,system-ui,sans-serif;color:var(--fg);background:var(--bg);-webkit-font-smoothing:antialiased}
.sx-page{max-width:56rem;margin:0 auto;padding:1.5rem 1rem 3rem}
.sx-page-head{display:flex;gap:1rem;align-items:flex-start;justify-content:space-between;margin-bottom:1.25rem}
.sx-page-head h1{font-size:1.25rem;font-weight:600;margin:0;letter-spacing:-.01em}
.sx-stack{display:flex;flex-direction:column}.sx-inline{display:flex;flex-wrap:wrap;align-items:center}
.sx-card{background:var(--card);border:1px solid var(--border);border-radius:calc(var(--radius) + 4px);padding:1.25rem;
box-shadow:0 1px 2px oklch(0 0 0/5%)}
.sx-card-head{margin-bottom:1rem}.sx-card-head h2{font-size:.95rem;font-weight:600;margin:0}
.sx-text{margin:0}.sx-subdued{color:var(--muted-fg)}.sx-success{color:var(--success)}.sx-warning{color:var(--warning)}
.sx-critical{color:var(--critical)}.sx-small{font-size:.8rem}.sx-strong{font-weight:600}
.sx-btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;height:2.25rem;padding:0 1rem;
border-radius:var(--radius);border:1px solid transparent;font:inherit;font-weight:500;cursor:pointer;text-decoration:none;
white-space:nowrap;transition:opacity .15s,background .15s}
.sx-btn:disabled{opacity:.5;pointer-events:none}.sx-btn:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
.sx-btn-primary{background:var(--primary);color:var(--primary-fg)}.sx-btn-primary:hover{opacity:.9}
.sx-btn-secondary{background:var(--card);color:var(--fg);border-color:var(--border)}.sx-btn-secondary:hover{background:var(--muted)}
.sx-btn-plain{background:transparent;color:var(--fg)}.sx-btn-plain:hover{background:var(--muted)}
.sx-btn-critical{background:var(--critical);color:#fff}.sx-btn-critical:hover{opacity:.9}
.sx-cmd{display:flex;gap:.75rem;align-items:center;justify-content:space-between;width:100%;margin-top:.5rem;
padding:.5rem .75rem;text-align:left;font:inherit;color:inherit;background:var(--muted);border:1px solid var(--border);
border-radius:var(--radius);cursor:pointer;transition:border-color .15s}
.sx-cmd:hover{border-color:var(--fg)}
.sx-cmd code{background:none;padding:0;min-width:0}
.sx-cmd-hint{flex:none;font-size:.75rem;opacity:.6}
.sx-field{display:flex;flex-direction:column;gap:.375rem}.sx-field label{font-weight:500}
.sx-input{height:2.25rem;width:100%;padding:0 .75rem;font:inherit;color:inherit;background:transparent;
border:1px solid var(--border);border-radius:var(--radius)}
textarea.sx-input{height:auto;min-height:5rem;padding:.5rem .75rem}
.sx-input:focus{outline:none;border-color:var(--ring);box-shadow:0 0 0 3px color-mix(in oklch,var(--ring) 35%,transparent)}
select.sx-input{appearance:none;-webkit-appearance:none;padding-right:2rem;
background:transparent url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='%23888' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 4.5l3 3 3-3'/%3E%3C/svg%3E") no-repeat right .7rem center}
.sx-disclosures{display:flex;flex-direction:column}
.sx-disclosure{padding:.75rem 0}.sx-disclosure+.sx-disclosure{border-top:1px solid var(--border)}
.sx-disclosure:first-child{padding-top:0}.sx-disclosure:last-child{padding-bottom:0}
.sx-disclosure>summary{display:flex;gap:.5rem;align-items:baseline;cursor:pointer;font-weight:500;list-style:none}
.sx-disclosure>summary::-webkit-details-marker{display:none}
.sx-disclosure>summary::after{content:'\\203A';margin-left:auto;font-size:1.25rem;line-height:1;color:var(--muted-fg);transition:transform .15s}
.sx-disclosure[open]>summary::after{transform:rotate(90deg)}
.sx-disclosure>summary span{font-weight:400;color:var(--muted-fg)}
.sx-disclosure>div{margin-top:.75rem}.sx-disclosure .sx-field{max-width:30rem}
.sx-filter-bar{position:sticky;top:0;z-index:1;display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin:-1.25rem -1.25rem 0;
padding:.75rem 1.25rem;background:var(--card);border-bottom:1px solid var(--border);border-radius:calc(var(--radius) + 4px) calc(var(--radius) + 4px) 0 0}
.sx-tabs{display:flex;flex-wrap:wrap;gap:.25rem;margin-right:auto}
.sx-tab{display:inline-flex;gap:.4rem;align-items:center;height:2rem;padding:0 .75rem;font:inherit;font-weight:500;color:var(--muted-fg);
background:transparent;border:1px solid transparent;border-radius:999px;cursor:pointer}
.sx-tab:hover{background:var(--muted)}.sx-tab[aria-pressed=true]{color:var(--fg);background:var(--muted);border-color:var(--border)}
.sx-tab b{font-weight:600;font-size:.8rem}.sx-tab-alert b{color:var(--warning)}
.sx-filter-bar .sx-input{width:auto;height:2rem}.sx-filter-bar input.sx-input{width:11rem}
.sx-nav{display:flex;gap:.25rem;border-bottom:1px solid var(--border);overflow-x:auto}
.sx-nav-tab{display:inline-flex;gap:.4rem;align-items:center;height:2.5rem;padding:0 .75rem;margin-bottom:-1px;font:inherit;font-weight:500;
color:var(--muted-fg);background:transparent;border:0;border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap}
.sx-nav-tab:hover{color:var(--fg)}.sx-nav-tab[aria-selected=true]{color:var(--fg);border-bottom-color:var(--fg)}
.sx-nav-tab:focus-visible{outline:2px solid var(--ring);outline-offset:-2px;border-radius:.25rem}
.sx-nav-tab b{font-weight:600;font-size:.8rem;padding:0 .4rem;border-radius:999px;background:var(--muted)}.sx-nav-alert b{background:color-mix(in oklch,var(--warning) 20%,transparent);color:var(--warning)}
.sx-view[hidden]{display:none}
.sx-item{padding:1rem 0;border-top:1px solid var(--border)}
.sx-empty{padding:1.5rem 0;text-align:center}
.sx-item[hidden],.sx-panel[hidden],.sx-empty[hidden]{display:none}
.sx-check{display:flex;gap:.5rem;align-items:center;font-weight:500}
.sx-badge{display:inline-flex;align-items:center;height:1.375rem;padding:0 .5rem;border-radius:999px;font-size:.75rem;
font-weight:500;background:var(--muted);color:var(--fg)}
.sx-badge.sx-success{background:color-mix(in oklch,var(--success) 15%,transparent)}
.sx-badge.sx-warning{background:color-mix(in oklch,var(--warning) 18%,transparent)}
.sx-badge.sx-critical{background:color-mix(in oklch,var(--critical) 15%,transparent)}
.sx-banner{display:flex;flex-direction:column;gap:.25rem;padding:.75rem 1rem;border-radius:var(--radius);
border:1px solid var(--border);background:var(--muted)}
.sx-banner.sx-success{border-color:color-mix(in oklch,var(--success) 40%,transparent);background:color-mix(in oklch,var(--success) 8%,transparent)}
.sx-banner.sx-warning{border-color:color-mix(in oklch,var(--warning) 40%,transparent);background:color-mix(in oklch,var(--warning) 8%,transparent)}
.sx-banner.sx-critical{border-color:color-mix(in oklch,var(--critical) 40%,transparent);background:color-mix(in oklch,var(--critical) 8%,transparent)}
.sx-banner strong{color:var(--fg)}
code,.sx-code{font:.85em ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--muted);padding:.1em .35em;border-radius:.3rem;word-break:break-all}
a{color:inherit;text-underline-offset:3px}
.sx-error:empty{display:none}
.sx-stat{display:flex;flex-direction:column;gap:.125rem}.sx-stat-value{font-size:1.5rem;font-weight:600;letter-spacing:-.02em}
`

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
