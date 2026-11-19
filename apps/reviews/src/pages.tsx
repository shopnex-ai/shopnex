import type { PropsWithChildren } from 'hono/jsx'
import {
  Badge,
  Banner,
  Button,
  Card,
  CopyableCode,
  Form,
  Inline,
  Page,
  Stack,
  Stat,
  Text,
  TextField,
} from '@shopnex/app/ui'
import type { Review } from './store'

const stars = (rating: number) => '★'.repeat(rating) + '☆'.repeat(5 - rating)

export function SettingsPage(props: {
  shopName: string
  instance: string
  shopId: string
  appUrl: string
  delayDays: number
  counts: { pending: number; published: number; hidden: number }
  pending: Review[]
  /** The shop has email off, so requests that are due wait (Settings → Email) */
  emailOff: boolean
  /** Requests that are due but not sent */
  waiting: number
  webhookError: string | null
}) {
  const snippet =
    `<div data-shopnex-reviews data-instance="${props.instance}" data-shop="${props.shopId}" data-product="{{ product.id }}"></div>\n` +
    `<script src="${props.appUrl}/widget.js" async></script>`
  return (
    <Page title="Reviews" subtitle={props.shopName}>
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
      <Inline gap={6}>
        <Stat label="Waiting for you" value={props.counts.pending} />
        <Stat label="Published" value={props.counts.published} />
        <Stat label="Hidden" value={props.counts.hidden} />
      </Inline>

      <Card title="Waiting for approval" description="Reviews appear in your store once you publish them.">
        {props.pending.length === 0 ? (
          <Text tone="subdued">Nothing to review right now.</Text>
        ) : (
          props.pending.map((review) => (
            <Stack gap={2}>
              <Inline gap={2}>
                <Text strong>{stars(review.rating)}</Text>
                <Text>{review.productTitle}</Text>
                {review.verified && <Badge tone="success">Verified buyer</Badge>}
              </Inline>
              {review.title && <Text strong>{review.title}</Text>}
              <Text>{review.body}</Text>
              <Text tone="subdued" size="small">
                {review.author}
              </Text>
              <Inline gap={2}>
                <Button action={`/api/reviews/${review.id}/publish`} reload>
                  Publish
                </Button>
                <Button variant="secondary" action={`/api/reviews/${review.id}/hide`} reload>
                  Hide
                </Button>
              </Inline>
            </Stack>
          ))
        )}
      </Card>

      <Card
        title="Show reviews in your store"
        description="Paste this into a Custom HTML section on your product page."
      >
        <CopyableCode value={snippet} />
      </Card>

      <Card title="Review requests">
        <Form action="/api/settings" success="Saved">
          <TextField
            label="Days after fulfillment"
            name="delayDays"
            type="number"
            value={props.delayDays}
            help="How long to wait before asking the buyer. 0 asks as soon as the order is fulfilled."
          />
          <Button>Save</Button>
        </Form>
      </Card>
    </Page>
  )
}

// The pages buyers see from their email link: plain, no admin
function Shell({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>{title}</title>
        <style>{`body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem}
label{display:block;margin:1rem 0 .25rem;font-weight:600}input,select,textarea{width:100%;padding:.5rem;font:inherit;box-sizing:border-box}
button{margin-top:1.25rem;padding:.6rem 1.2rem;font:inherit;cursor:pointer}.error{color:#b91c1c}`}</style>
      </head>
      <body>{children}</body>
    </html>
  )
}

export function ReviewFormPage({ productTitle, error }: { productTitle: string; error?: string }) {
  return (
    <Shell title={`Review ${productTitle}`}>
      <h1>How was {productTitle}?</h1>
      {error && <p class="error">{error}</p>}
      <form method="post">
        <label for="rating">Rating</label>
        <select id="rating" name="rating" required>
          <option value="5">★★★★★ Great</option>
          <option value="4">★★★★☆ Good</option>
          <option value="3">★★★☆☆ Okay</option>
          <option value="2">★★☆☆☆ Poor</option>
          <option value="1">★☆☆☆☆ Bad</option>
        </select>
        <label for="title">Headline (optional)</label>
        <input id="title" name="title" maxlength={120} />
        <label for="body">Your review</label>
        <textarea id="body" name="body" rows={5} maxlength={5000} required></textarea>
        <label for="author">Your name (optional)</label>
        <input id="author" name="author" maxlength={80} autocomplete="name" />
        <button type="submit">Send review</button>
      </form>
    </Shell>
  )
}

export function MessagePage({ title, message }: { title: string; message: string }) {
  return (
    <Shell title={title}>
      <h1>{title}</h1>
      <p>{message}</p>
    </Shell>
  )
}
