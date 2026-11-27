import { raw } from 'hono/html'
import type { PropsWithChildren } from 'hono/jsx'
import {
  Badge,
  Banner,
  Button,
  Card,
  CopyableCode,
  FilterItem,
  Filterable,
  Form,
  Page,
  Panel,
  Select,
  Stat,
  TabPanel,
  Tabs,
  Text,
  TextField,
} from '@shopnex/app/ui'
import { renderEmail } from './mailer'
import type { RequestRow, Review } from './store'

const stars = (rating: number) => '★'.repeat(rating) + '☆'.repeat(5 - rating)
const date = (ms: number) =>
  new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })

const PUBLISH_OPTIONS = [
  { value: 'off', label: 'I approve each review myself' },
  { value: 'positive', label: 'Publish 4 and 5 star reviews automatically' },
  { value: 'all', label: 'Publish every review automatically' },
]

const STATUS_BADGE: Record<Review['status'], { tone: 'warning' | 'success' | 'default'; label: string }> = {
  pending: { tone: 'warning', label: 'Waiting' },
  published: { tone: 'success', label: 'Published' },
  hidden: { tone: 'default', label: 'Hidden' },
}

// Only what is specific to a review row; tabs, filters, settings rows and panels come from the shared kit
const css = `
.snx-top{display:flex;flex-wrap:wrap;align-items:center;gap:.25rem .75rem}.snx-top .snx-badge{margin-left:auto}
.snx-stars{letter-spacing:.1em;white-space:nowrap}.snx-stars i{font-style:normal;color:#e8a317}.snx-stars u{text-decoration:none;opacity:.25}
.snx-body{margin:.5rem 0 .25rem;white-space:pre-line}
.snx-reply{margin:.6rem 0 0;padding:.1rem 0 .1rem .75rem;border-left:3px solid var(--border)}
.snx-actions{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.75rem}.snx-actions .sx-btn{height:2rem;padding:0 .75rem}.snx-actions .snx-sep{flex:1}
.snx-replybox{margin-top:.75rem}
.snx-overview{display:grid;grid-template-columns:minmax(8rem,auto) minmax(12rem,1fr);gap:1rem 2.5rem;align-items:center}
@media (max-width:34rem){.snx-overview{grid-template-columns:1fr}}
.snx-avg{font-size:2.75rem;font-weight:700;line-height:1;letter-spacing:-.03em}
.snx-bars{display:flex;flex-direction:column;gap:.35rem;max-width:26rem}
.snx-bar{display:flex;align-items:center;gap:.6rem;font-size:.85em}.snx-bar>span:first-child{width:.9rem;text-align:right}.snx-bar>span:last-child{width:2rem;color:var(--muted-fg)}
.snx-track{flex:1;height:.5rem;border-radius:999px;background:var(--muted);overflow:hidden}.snx-fill{height:100%;border-radius:999px;background:#e8a317}
.snx-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(8rem,1fr));gap:1rem;padding-top:1rem;border-top:1px solid var(--border)}
.snx-head{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem 1rem}.snx-head h2{margin:0;font-size:.95rem;font-weight:600}.snx-head .snx-end{margin-left:auto}
.snx-rowline{display:flex;flex-wrap:wrap;align-items:center;gap:.25rem 1rem}.snx-rowline .snx-grow{flex:1;min-width:12rem}
.snx-products{display:flex;flex-direction:column}.snx-products>div{display:flex;align-items:center;gap:1rem;padding:.6rem 0;border-top:1px solid var(--border)}.snx-products>div:first-child{border-top:0;padding-top:0}
.snx-products .snx-grow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.snx-steps{margin:0;padding-left:1.25rem;display:flex;flex-direction:column;gap:.5rem}
.snx-preview{border:1px solid var(--border);border-radius:var(--radius);padding:1rem;background:var(--muted)}
.snx-preview p{margin:.4rem 0 0;white-space:pre-line}
`

function ReviewCard({ review }: { review: Review }) {
  const badge = STATUS_BADGE[review.status]
  return (
    <FilterItem
      tab={review.status}
      values={{ rating: review.rating, product: review.productId }}
      text={`${review.title} ${review.body} ${review.author} ${review.productTitle}`}
    >
      <div class="snx-top">
        <span class="snx-stars" role="img" aria-label={`${review.rating} out of 5 stars`}>
          <i>{'★'.repeat(review.rating)}</i>
          <u>{'★'.repeat(5 - review.rating)}</u>
        </span>
        {review.title && <Text strong>{review.title}</Text>}
        <span class="snx-badge">
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </span>
      </div>
      <p class="sx-text snx-body">{review.body}</p>
      <p class="sx-text sx-subdued sx-small">
        {review.author}
        {review.verified && ' · Verified buyer'} · {date(review.createdAt)} · {review.productTitle}
      </p>
      {review.reply && (
        <div class="snx-reply">
          <Text tone="subdued" size="small">
            Your reply
          </Text>
          <p class="sx-text snx-body" style="margin:0">
            {review.reply}
          </p>
        </div>
      )}
      <div class="snx-actions">
        {review.status !== 'published' && (
          <Button
            variant={review.status === 'pending' ? 'primary' : 'secondary'}
            action={`/api/reviews/${review.id}/publish`}
            reload
          >
            Publish
          </Button>
        )}
        {review.status !== 'hidden' && (
          <Button variant="secondary" action={`/api/reviews/${review.id}/hide`} reload>
            Hide
          </Button>
        )}
        <Button variant="plain" toggles={`reply-${review.id}`}>
          {review.reply ? 'Edit reply' : 'Reply'}
        </Button>
        <span class="snx-sep" />
        <Button
          variant="plain"
          action={`/api/reviews/${review.id}`}
          method="DELETE"
          confirm={{
            title: 'Delete this review?',
            message: `The ${review.rating}-star review by ${review.author} will be removed for good. This can't be undone.`,
            label: 'Delete',
          }}
          reload
        >
          Delete
        </Button>
      </div>
      <Panel id={`reply-${review.id}`}>
        <div class="snx-replybox">
          <Form action={`/api/reviews/${review.id}/reply`} reload>
            <TextField
              label="Your reply"
              name="reply"
              multiline
              value={review.reply}
              help="Shown under the review in your store. Leave it empty to remove it."
            />
            <div>
              <Button>Save reply</Button>
            </div>
          </Form>
        </div>
      </Panel>
    </FilterItem>
  )
}

function Stars({ rating }: { rating: number }) {
  const full = Math.round(rating)
  return (
    <span class="snx-stars" role="img" aria-label={`${rating} out of 5 stars`}>
      <i>{'★'.repeat(full)}</i>
      <u>{'★'.repeat(5 - full)}</u>
    </span>
  )
}

type Overview = {
  count: number
  average: number | null
  distribution: Record<1 | 2 | 3 | 4 | 5, number>
  requests: { total: number; sent: number; reviewed: number }
}

// The numbers a merchant looks for first: how the shop is rated, and whether buyers answer
function OverviewCard({ overview, pending }: { overview: Overview; pending: number }) {
  const { count, average, distribution, requests } = overview
  const rate = requests.sent > 0 ? `${Math.round((requests.reviewed / requests.sent) * 100)}%` : '–'
  return (
    <Card>
      <div class="snx-overview">
        <div>
          <div class="snx-avg">{average === null ? '–' : average.toFixed(1)}</div>
          {average !== null && <Stars rating={average} />}
          <Text tone="subdued" size="small">
            {count === 0 ? 'No published reviews yet' : `${count} published ${count === 1 ? 'review' : 'reviews'}`}
          </Text>
        </div>
        <div class="snx-bars">
          {([5, 4, 3, 2, 1] as const).map((n) => (
            <div class="snx-bar">
              <span>{n}</span>
              <div class="snx-track">
                <div class="snx-fill" style={`width:${count ? (distribution[n] / count) * 100 : 0}%`} />
              </div>
              <span>{distribution[n]}</span>
            </div>
          ))}
        </div>
      </div>
      <div class="snx-stats">
        <Stat label="Waiting for you" value={pending} />
        <Stat label="Requests sent" value={requests.sent} />
        <Stat label="Answered" value={requests.reviewed} />
        <Stat label="Review rate" value={rate} />
      </div>
    </Card>
  )
}

function RequestRowView({ request }: { request: RequestRow }) {
  const now = Date.now()
  const when =
    request.status === 'reviewed'
      ? 'Reviewed'
      : request.status === 'sent'
        ? `Sent ${date(request.sentAt ?? request.sendAfter)}`
        : request.sendAfter <= now
          ? 'Goes out within a minute'
          : `Goes out ${date(request.sendAfter)}`
  return (
    <FilterItem
      tab={request.status}
      text={`${request.email} ${request.productTitle}`}
      values={{ product: request.productId }}
    >
      <div class="snx-rowline">
        <div class="snx-grow">
          <Text strong>{request.productTitle}</Text>
          <Text tone="subdued" size="small">
            {request.email} · {when}
          </Text>
        </div>
        <Badge tone={request.status === 'reviewed' ? 'success' : 'default'}>
          {{ scheduled: 'Scheduled', sent: 'Sent', reviewed: 'Reviewed' }[request.status]}
        </Badge>
        {request.status === 'scheduled' && (
          <Button variant="secondary" action={`/api/requests/${request.token}/send-now`} reload>
            Send now
          </Button>
        )}
      </div>
    </FilterItem>
  )
}

export type AdminPageProps = {
  instance: string
  shopId: string
  appUrl: string
  delayDays: number
  publishMode: string
  counts: { pending: number; published: number; hidden: number }
  overview: Overview
  /** Most reviewed first */
  products: { productId: string; title: string; total: number; published: number; average: number | null }[]
  /** Newest first; capped, see the counts */
  reviews: Review[]
  /** Newest first; capped */
  requests: RequestRow[]
  /** The shop's own wording of the request email; empty means the standard text */
  emailTexts: { subject: string; message: string }
  /** Email is off, so requests that are due wait (Settings → Email) */
  emailOff: boolean
  /** Requests that are due but not sent */
  waiting: number
  webhookError: string | null
}

export function AdminPage(props: AdminPageProps) {
  const snippet =
    `<div data-shopnex-reviews data-instance="${props.instance}" data-shop="${props.shopId}" data-product="{{ product.id }}"></div>\n` +
    `<script src="${props.appUrl}/widget.js" async></script>`
  const { pending, published, hidden } = props.counts
  const total = pending + published + hidden
  const requestCounts = { scheduled: 0, sent: 0, reviewed: 0 }
  for (const r of props.requests) requestCounts[r.status]++
  // What the review list opens on: what needs the merchant, else everything
  const defaultTab = pending > 0 ? 'pending' : 'all'
  const publishLabel = PUBLISH_OPTIONS.find((o) => o.value === props.publishMode)?.label
  const productOptions = [...new Map(props.reviews.map((r) => [r.productId, r.productTitle]))].map(
    ([value, label]) => ({
      value,
      label,
    }),
  )
  // The email as the buyer gets it, for a made-up product; the link is shown as a button label
  const preview = renderEmail({
    productTitle: 'Ceramic Cup',
    shopName: 'Your shop',
    link: '[Write a review]',
    ...props.emailTexts,
  })
  return (
    <Page title="Reviews" header={false}>
      <style>{raw(css)}</style>
      {props.webhookError && (
        <Banner tone="critical" title="Review requests are not set up">
          {props.webhookError}
        </Banner>
      )}
      {props.emailOff && (
        <Banner tone="warning" title="Turn on email to send review requests">
          {props.waiting > 0
            ? `${props.waiting} ${props.waiting === 1 ? 'request is' : 'requests are'} waiting to go out. `
            : 'Buyers are asked for a review by email. '}
          Email is off for your shop: set up sending in Settings → Email, and they go out within a minute.
        </Banner>
      )}

      <OverviewCard overview={props.overview} pending={pending} />

      <Tabs
        defaultTab="reviews"
        tabs={[
          { id: 'reviews', label: 'Reviews', count: pending, alert: true },
          { id: 'requests', label: 'Requests', count: requestCounts.scheduled },
          { id: 'widget', label: 'Widget' },
          { id: 'settings', label: 'Settings' },
        ]}
      />

      <TabPanel id="reviews">
        {total === 0 ? (
          <Banner title="No reviews yet">
            Buyers get an email asking for a review{' '}
            {props.delayDays === 0 ? 'right after' : `${props.delayDays} days after`} their order is fulfilled. Add the
            widget (see Widget) so reviews show in your store.
          </Banner>
        ) : (
          <>
            {pending > 0 && (
              <Banner title={`${pending} ${pending === 1 ? 'review is' : 'reviews are'} waiting for you`}>
                Look {pending === 1 ? 'it' : 'them'} over below, or publish {pending === 1 ? 'it' : 'them all'} at once.
                <div style="margin-top:.5rem">
                  <Button
                    variant="secondary"
                    action="/api/publish-pending"
                    confirm={{
                      title: 'Publish all waiting reviews?',
                      message: `${pending} ${pending === 1 ? 'review' : 'reviews'} will show in your store.`,
                      label: 'Publish all',
                    }}
                    reload
                  >
                    Publish all waiting
                  </Button>
                </div>
              </Banner>
            )}
            <Card>
              <Filterable
                name="reviews"
                tabs={[
                  { value: 'pending', label: 'Waiting', count: pending, alert: true },
                  { value: 'published', label: 'Published', count: published },
                  { value: 'hidden', label: 'Hidden', count: hidden },
                  { value: 'all', label: 'All', count: total },
                ]}
                defaultTab={defaultTab}
                filters={[
                  {
                    name: 'rating',
                    label: 'Any rating',
                    options: [5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: stars(n) })),
                  },
                  ...(productOptions.length > 1
                    ? [{ name: 'product', label: 'Any product', options: productOptions }]
                    : []),
                ]}
                search="Search reviews"
                noun="review"
                empty="Nothing is waiting for you."
              >
                {props.reviews.map((review) => (
                  <ReviewCard review={review} />
                ))}
              </Filterable>
              {total > props.reviews.length && (
                <Text tone="subdued" size="small">
                  Showing the latest {props.reviews.length} of {total} reviews.
                </Text>
              )}
            </Card>
          </>
        )}
        {props.products.length > 0 && (
          <Card title="By product" description="Which products buyers write about, and how they rate them">
            <div class="snx-products">
              {props.products.map((product) => (
                <div>
                  <span class="snx-grow">{product.title}</span>
                  {product.average !== null ? <Stars rating={product.average} /> : <Text tone="subdued">–</Text>}
                  <Text tone="subdued" size="small">
                    {product.published} published
                    {product.total > product.published && `, ${product.total - product.published} not`}
                  </Text>
                </div>
              ))}
            </div>
          </Card>
        )}
      </TabPanel>

      <TabPanel id="requests">
        <Text tone="subdued">
          Each fulfilled order asks the buyer for a review{' '}
          {props.delayDays === 0 ? 'right away' : `${props.delayDays} days later`}, once per product.
        </Text>
        <Card>
          {props.requests.length === 0 ? (
            <Text tone="subdued">
              Nothing yet. A request is made for every product of an order when the order is fulfilled.
            </Text>
          ) : (
            <Filterable
              name="requests"
              tabs={[
                { value: 'scheduled', label: 'Scheduled', count: requestCounts.scheduled },
                { value: 'sent', label: 'Sent', count: requestCounts.sent },
                { value: 'reviewed', label: 'Reviewed', count: requestCounts.reviewed },
                { value: 'all', label: 'All', count: props.requests.length },
              ]}
              defaultTab={requestCounts.scheduled > 0 ? 'scheduled' : 'all'}
              search="Search requests"
              noun="request"
              empty="No requests here."
            >
              {props.requests.map((request) => (
                <RequestRowView request={request} />
              ))}
            </Filterable>
          )}
        </Card>
      </TabPanel>

      <TabPanel id="widget">
        <Card title="Show reviews in your store" description="One snippet, on the product page">
          <ol class="snx-steps">
            <li>Open your theme in Online store → Customize, on a product page.</li>
            <li>Add a Custom HTML section where the reviews should go.</li>
            <li>Paste this in, and publish the theme.</li>
          </ol>
          <CopyableCode value={snippet} />
          <Text tone="subdued" size="small">
            It shows the average rating, the breakdown and the published reviews with your replies, and tells search
            engines the product's rating. It takes the font and colours of your theme.
          </Text>
        </Card>
      </TabPanel>

      <TabPanel id="settings">
        <Card title="Publishing" description={publishLabel}>
          <Form action="/api/publishing" success="Saved" reload>
            <Select
              label="New reviews"
              name="publishMode"
              value={props.publishMode}
              options={PUBLISH_OPTIONS}
              help="Reviews you don't publish automatically wait under Reviews → Waiting."
            />
            <div>
              <Button>Save</Button>
            </div>
          </Form>
        </Card>
        <Card title="When to ask">
          <Form action="/api/settings" success="Saved" reload>
            <TextField
              label="Days after fulfillment"
              name="delayDays"
              type="number"
              value={props.delayDays}
              help="How long to wait before asking the buyer. 0 asks as soon as the order is fulfilled."
            />
            <div>
              <Button>Save</Button>
            </div>
          </Form>
        </Card>
        <Card title="The request email" description="What buyers read. Leave a field empty for the standard text.">
          <Form action="/api/email" success="Saved" reload>
            <TextField
              label="Subject"
              name="subject"
              value={props.emailTexts.subject}
              placeholder="How was your {product}?"
              help="{product} and {shop} are filled in."
            />
            <TextField
              label="Message"
              name="message"
              multiline
              value={props.emailTexts.message}
              placeholder={
                'Thanks for your order from {shop}.\n\nWould you leave a quick review of {product}? It helps other shoppers.'
              }
              help="A blank line starts a new paragraph. The link to the review page is added under it."
            />
            <div>
              <Button>Save</Button>
            </div>
          </Form>
          <div class="snx-preview" aria-label="Preview of the email">
            <Text tone="subdued" size="small">
              Preview, for a product named Ceramic Cup
            </Text>
            <p>
              <strong>{preview.subject}</strong>
            </p>
            <p>{preview.text.replace('[Write a review]\n', '').trim()}</p>
            <p>
              <u>Write a review</u>
            </p>
          </div>
        </Card>
      </TabPanel>
    </Page>
  )
}

// The pages buyers see from their email link: one centred card, no admin
const buyerCss = `
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:#f6f6f4;color:#1c1c1a;font:16px/1.5 system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;padding:1rem}
main{background:#fff;border:1px solid #e4e4e0;border-radius:16px;padding:2rem;width:100%;max-width:32rem;box-shadow:0 1px 3px #0000000d}
h1{font-size:1.4rem;line-height:1.25;margin:0 0 .25rem}
.sub{color:#6b6b66;margin:0 0 1.5rem}
label.l{display:block;margin:1.25rem 0 .35rem;font-weight:600;font-size:.95rem}
input[type=text],textarea{width:100%;padding:.65rem .75rem;font:inherit;border:1px solid #d4d4cf;border-radius:10px;background:#fff}
input[type=text]:focus,textarea:focus{outline:2px solid #e8a317;outline-offset:1px;border-color:#e8a317}
.rating{display:flex;flex-direction:row-reverse;justify-content:flex-end;gap:.15rem}
.rating input{position:absolute;opacity:0;pointer-events:none}
.rating label{font-size:2.4rem;line-height:1;color:#d4d4cf;cursor:pointer;padding:0 .1rem;transition:color .1s,transform .1s}
.rating label:hover{transform:scale(1.1)}
.rating label:hover,.rating label:hover~label,.rating input:checked~label{color:#e8a317}
.rating input:focus-visible+label{outline:2px solid #e8a317;border-radius:6px}
button{margin-top:1.5rem;width:100%;padding:.8rem 1.2rem;font:inherit;font-weight:600;color:#fff;background:#1c1c1a;border:0;border-radius:10px;cursor:pointer}
button:hover{opacity:.9}
.error{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:10px;padding:.6rem .8rem;margin:0 0 1rem}
@media (prefers-color-scheme:dark){body{background:#121211;color:#f1f1ee}main{background:#1c1c1a;border-color:#2e2e2b}.sub{color:#a3a39d}
input[type=text],textarea{background:#121211;border-color:#3a3a36;color:inherit}.rating label{color:#3a3a36}button{background:#f1f1ee;color:#1c1c1a}
.error{background:#3b1414;border-color:#7f1d1d;color:#fca5a5}}
`

function Shell({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>{title}</title>
        <style>{raw(buyerCss)}</style>
      </head>
      <body>
        <main>{children}</main>
      </body>
    </html>
  )
}

const RATING_LABELS: [number, string][] = [
  [5, 'Great'],
  [4, 'Good'],
  [3, 'Okay'],
  [2, 'Poor'],
  [1, 'Bad'],
]

export function ReviewFormPage({ productTitle, error }: { productTitle: string; error?: string }) {
  return (
    <Shell title={`Review ${productTitle}`}>
      <h1>How was {productTitle}?</h1>
      <p class="sub">Your review helps other shoppers decide.</p>
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      <form method="post">
        <span class="l" style="margin-top:0;display:block;font-weight:600;font-size:.95rem">
          Your rating
        </span>
        <div class="rating">
          {RATING_LABELS.map(([value, label]) => (
            <>
              <input type="radio" id={`r${value}`} name="rating" value={String(value)} required />
              <label
                for={`r${value}`}
                title={label}
                aria-label={`${value} ${value === 1 ? 'star' : 'stars'}: ${label}`}
              >
                ★
              </label>
            </>
          ))}
        </div>
        <label class="l" for="title">
          Headline (optional)
        </label>
        <input type="text" id="title" name="title" maxlength={120} placeholder="Sum it up in a few words" />
        <label class="l" for="body">
          Your review
        </label>
        <textarea
          id="body"
          name="body"
          rows={5}
          maxlength={5000}
          required
          placeholder="What did you like or dislike?"
        ></textarea>
        <label class="l" for="author">
          Your name (optional)
        </label>
        <input type="text" id="author" name="author" maxlength={80} autocomplete="name" />
        <button type="submit">Send review</button>
      </form>
    </Shell>
  )
}

export function MessagePage({ title, message }: { title: string; message: string }) {
  return (
    <Shell title={title}>
      <h1>{title}</h1>
      <p class="sub" style="margin:.5rem 0 0">
        {message}
      </p>
    </Shell>
  )
}
