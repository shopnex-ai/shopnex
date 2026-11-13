// The docs home page (content/docs/index.mdx renders <Home />): a hero, learning paths and a tour of the product.
import { ArrowRight, ArrowUpRight, Blocks, Rocket, Server, Store, type LucideIcon } from 'lucide-react'
import { CopyCommand } from './copy-command'
// The product screenshots live in the repo's docs/images (the README uses them too)
import adminDashboard from '../../../docs/images/dashboard.png'
import storefront from '../../../docs/images/storefront.webp'

const DEMO_URL = 'https://demo.shopnex.ai/admin/signup?demo=true'

const eyebrow = 'font-mono text-xs uppercase tracking-widest text-fd-muted-foreground'

type Path = { icon: LucideIcon; title: string; text: string; href: string }

const paths: Path[] = [
  {
    icon: Rocket,
    title: 'Run a shop',
    text: 'One command on your machine, then deploy it with Docker when you are ready.',
    href: '/docs/quickstart',
  },
  {
    icon: Store,
    title: 'Build a storefront',
    text: 'Edit the bundled Liquid themes, or go headless with the typed Storefront API.',
    href: '/docs/storefronts',
  },
  {
    icon: Blocks,
    title: 'Build an app',
    text: 'Extend the admin with an out-of-process app, scoped tokens and signed webhooks.',
    href: '/docs/apps',
  },
]

const reference: { title: string; text: string; href: string }[] = [
  { title: 'Storefront API', text: 'Products, carts and checkout for any frontend.', href: '/docs/api/storefront' },
  { title: 'Admin API', text: 'REST and RPC for integrations, with scoped tokens.', href: '/docs/api/admin' },
  { title: 'Webhooks', text: 'Signed events for orders, products and customers.', href: '/docs/api/webhooks' },
  { title: 'App SDK', text: 'Authenticate, call the Admin API, store per-shop data.', href: '/docs/apps/sdk' },
  { title: 'Self-hosting', text: 'Docker, Dokploy, Railway and configuration.', href: '/docs/self-hosting' },
  {
    title: 'Architecture',
    text: 'How the modules fit together and where the rules are.',
    href: '/docs/concepts/modules',
  },
]

function Card({ href, className = '', children }: { href: string; className?: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className={`group block rounded-2xl border border-fd-border bg-fd-card p-6 no-underline transition-colors hover:border-fd-primary/60 ${className}`}
    >
      {children}
    </a>
  )
}

function Shot({ src, alt, caption }: { src: string; alt: string; caption: string }) {
  return (
    <figure className="m-0 overflow-hidden rounded-2xl border border-fd-border bg-fd-card">
      <img src={src} alt={alt} loading="lazy" className="block w-full" />
      <figcaption className="border-t border-fd-border px-5 py-3 text-sm text-fd-muted-foreground">
        {caption}
      </figcaption>
    </figure>
  )
}

export function Home() {
  return (
    <div className="not-prose flex flex-col gap-20 pb-8 pt-4">
      <section className="flex flex-col gap-8">
        <h1 className="max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl">
          Commerce you run yourself
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-fd-muted-foreground">
          ShopNex is an open-source Shopify alternative. An admin, a themeable storefront, hosted checkout, a typed API
          and webhooks, with apps that extend it from outside. MIT licensed, no platform fees, your data in your
          database.
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href="/docs/quickstart"
            className="inline-flex items-center gap-2 rounded-xl bg-fd-primary px-5 py-3 font-medium text-fd-primary-foreground no-underline"
          >
            Get started <ArrowRight size={16} />
          </a>
          <a
            href={DEMO_URL}
            className="inline-flex items-center gap-2 rounded-xl border border-fd-border px-5 py-3 font-medium no-underline hover:bg-fd-accent"
          >
            Try the live demo <ArrowUpRight size={16} />
          </a>
        </div>
        <div className="flex max-w-xl flex-col gap-2">
          <span className={eyebrow}>Quick install</span>
          <CopyCommand command="npx create-shopnex@latest my-shop" />
        </div>
      </section>

      <section className="flex flex-col gap-6 border-t border-fd-border pt-12">
        <div className="flex flex-col gap-2">
          <span className={eyebrow}>Learning paths</span>
          <h2 className="m-0 text-3xl font-semibold tracking-tight">Start where you are</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {paths.map(({ icon: Icon, title, text, href }) => (
            <Card key={title} href={href}>
              <div className="mb-4 flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-fd-accent">
                  <Icon size={18} />
                </span>
                <span className="text-lg font-semibold">{title}</span>
              </div>
              <p className="m-0 text-sm leading-relaxed text-fd-muted-foreground">{text}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-6 border-t border-fd-border pt-12">
        <div className="flex flex-col gap-2">
          <span className={eyebrow}>What you get</span>
          <h2 className="m-0 text-3xl font-semibold tracking-tight">An admin and a storefront out of the box</h2>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Shot
            src={adminDashboard.src}
            alt="ShopNex admin dashboard with sales analytics"
            caption="Admin: products, orders, shipping, payments, staff and settings, all in the browser."
          />
          <Shot
            src={storefront.src}
            alt="ShopNex storefront home page with a hero banner"
            caption="Storefront: an Astro app that renders Liquid themes you edit under Online store."
          />
        </div>
      </section>

      <section className="flex flex-col gap-6 border-t border-fd-border pt-12">
        <div className="flex flex-col gap-2">
          <span className={eyebrow}>Reference</span>
          <h2 className="m-0 text-3xl font-semibold tracking-tight">Build on the platform</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {reference.map(({ title, text, href }) => (
            <Card key={title} href={href} className="p-5">
              <div className="mb-1 flex items-center justify-between font-semibold">
                {title}
                <ArrowRight
                  size={16}
                  className="text-fd-muted-foreground transition-transform group-hover:translate-x-0.5"
                />
              </div>
              <p className="m-0 text-sm text-fd-muted-foreground">{text}</p>
            </Card>
          ))}
        </div>
      </section>
    </div>
  )
}
