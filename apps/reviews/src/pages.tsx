import { raw } from 'hono/html'
import type { PropsWithChildren } from 'hono/jsx'
import {
  Badge,
  Banner,
  Button,
  Card,
  CopyableCode,
  Disclosure,
  Disclosures,
  FilterItem,
  Filterable,
  Form,
  Inline,
  Page,
  Panel,
  Select,
  Stack,
  Stat,
  Text,
  TextField,
} from '@shopnex/app/ui'
import type { Review } from './store'

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
`

function ReviewCard({ review }: { review: Review }) {
  const badge = STATUS_BADGE[review.status]
  return (
    <FilterItem
      tab={review.status}
      values={{ rating: review.rating }}
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
          confirm="Click again to delete"
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

export function SettingsPage(props: {
  shopName: string
  instance: string
  shopId: string
  appUrl: string
  delayDays: number
  publishMode: string
  counts: { pending: number; published: number; hidden: number }
  /** Newest first; capped, see the counts */
  reviews: Review[]
  /** Email is off, so requests that are due wait (Settings → Email) */
  emailOff: boolean
  /** Requests that are due but not sent */
  waiting: number
  webhookError: string | null
}) {
  const snippet =
    `<div data-shopnex-reviews data-instance="${props.instance}" data-shop="${props.shopId}" data-product="{{ product.id }}"></div>\n` +
    `<script src="${props.appUrl}/widget.js" async></script>`
  const { pending, published, hidden } = props.counts
  const total = pending + published + hidden
  // What the page opens on: what needs the merchant, else everything
  const defaultTab = pending > 0 ? 'pending' : 'all'
  const publishLabel = PUBLISH_OPTIONS.find((o) => o.value === props.publishMode)?.label
  return (
    <Page title="Reviews" subtitle={props.shopName}>
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

      <Card title="Settings">
        <Disclosures>
          <Disclosure title="Publishing" summary={publishLabel}>
            <Form action="/api/publishing" success="Saved" reload>
              <Select
                label="New reviews"
                name="publishMode"
                value={props.publishMode}
                options={PUBLISH_OPTIONS}
                help="Reviews you don't publish automatically wait under Waiting."
              />
              <div>
                <Button>Save</Button>
              </div>
            </Form>
          </Disclosure>
          <Disclosure
            title="Review requests"
            summary={props.delayDays === 0 ? 'right after fulfillment' : `${props.delayDays} days after fulfillment`}
          >
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
          </Disclosure>
          <Disclosure
            title="Show reviews in your store"
            summary="paste into a Custom HTML section on your product page"
            open={total === 0}
          >
            <CopyableCode value={snippet} />
          </Disclosure>
        </Disclosures>
      </Card>

      {total === 0 ? (
        <Banner title="No reviews yet">
          Buyers get an email asking for a review{' '}
          {props.delayDays === 0 ? 'right after' : `${props.delayDays} days after`} their order is fulfilled. Add the
          widget above so reviews show in your store.
        </Banner>
      ) : (
        <Card>
          <Filterable
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
      )}
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
