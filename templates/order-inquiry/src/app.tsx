import type { ShopnexApp } from '@shopnex/app'
import { Button, Card, Form, Page, Text, TextField } from '@shopnex/app/ui'
import { createOrderInquiryRoutes } from './routes'

export { orderReferences } from './routes'

export function createOrderInquiryApp(shopnex: Pick<ShopnexApp, 'routes' | 'authenticate'>) {
  const app = createOrderInquiryRoutes(shopnex)
  app.get('/', async (c) => {
    const { shop } = await shopnex.authenticate(c)
    return c.html(
      <Page title="Order inquiry" subtitle={shop.name}>
        <Card title="Create a reference">
          <Text>Copy an order link from your admin. The order number stays the same.</Text>
          <Form action="/api/reference">
            <TextField label="Order link" name="orderLink" required />
            <Button>Create reference</Button>
          </Form>
          <p>
            <output id="reference-result" aria-live="polite" />
          </p>
        </Card>
        <Card title="Find an order">
          <Text>Enter the reference quoted by the customer. Confirm the order details before taking action.</Text>
          <Form action="/api/lookup">
            <TextField label="Order reference" name="reference" required />
            <Button>Find order</Button>
          </Form>
        </Card>
        <script src="/reference-result.js" type="module" />
      </Page>,
    )
  })

  app.get('/reference-result.js', (c) =>
    c.body(
      "document.addEventListener('shopnex:done', (event) => {\n" +
        "  if (typeof event.detail?.reference !== 'string') return;\n" +
        "  document.getElementById('reference-result').textContent = event.detail.reference;\n" +
        '});\n',
      200,
      { 'content-type': 'text/javascript' },
    ),
  )

  return app
}
