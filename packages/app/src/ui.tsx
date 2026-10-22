/** @jsxRuntime automatic @jsxImportSource hono/jsx */
// Server-rendered components (hono/jsx) that look like the Shopnex admin, for an app's embedded pages. No build
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

const styles = `
:root{color-scheme:light dark;--bg:oklch(1 0 0);--fg:oklch(.145 0 0);--card:oklch(1 0 0);--muted:oklch(.97 0 0);
--muted-fg:oklch(.556 0 0);--border:oklch(.922 0 0);--primary:oklch(.205 0 0);--primary-fg:oklch(.985 0 0);
--critical:oklch(.577 .245 27.325);--success:oklch(.52 .14 150);--warning:oklch(.62 .15 70);--ring:oklch(.708 0 0);
--radius:.625rem}
@media (prefers-color-scheme:dark){:root{--bg:oklch(.145 0 0);--fg:oklch(.985 0 0);--card:oklch(.205 0 0);
--muted:oklch(.269 0 0);--muted-fg:oklch(.708 0 0);--border:oklch(1 0 0/10%);--primary:oklch(.922 0 0);
--primary-fg:oklch(.205 0 0);--critical:oklch(.704 .191 22.216);--success:oklch(.72 .15 150);--warning:oklch(.8 .14 80);
--ring:oklch(.556 0 0)}}
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
.sx-field{display:flex;flex-direction:column;gap:.375rem}.sx-field label{font-weight:500}
.sx-input{height:2.25rem;width:100%;padding:0 .75rem;font:inherit;color:inherit;background:transparent;
border:1px solid var(--border);border-radius:var(--radius)}
textarea.sx-input{height:auto;min-height:5rem;padding:.5rem .75rem}
.sx-input:focus{outline:none;border-color:var(--ring);box-shadow:0 0 0 3px color-mix(in oklch,var(--ring) 35%,transparent)}
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
 * `actions` sit next to the title.
 */
export function Page({
  title,
  subtitle,
  actions,
  children,
}: PropsWithChildren<{ title: string; subtitle?: string; actions?: Child }>) {
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
            <header class="sx-page-head">
              <div>
                <h1>{title}</h1>
                {subtitle && <p class="sx-text sx-subdued">{subtitle}</p>}
              </div>
              {actions && (
                <div class="sx-inline" style="gap:.5rem">
                  {actions}
                </div>
              )}
            </header>
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
}

const actionAttrs = ({ action, method, reload, success }: ActionProps) => ({
  'data-shopnex-action': action,
  'data-method': method,
  'data-reload': reload ? '' : undefined,
  'data-success': success,
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
  ActionProps & { variant?: 'primary' | 'secondary' | 'plain' | 'critical'; href?: string; external?: boolean }
>) {
  const cls = `sx-btn sx-btn-${variant}`
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
