// Built-in Liquid for each notification: what a shop sends until it edits one (Settings → Notifications), and
// what "Revert to default" goes back to. Simple table HTML with inline styles, the kind email clients render.
import type { Notification } from '@shopnex/db/schema'

const BUTTON =
  'display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;'
const BOX = 'background:#f4f4f5;border-radius:6px;padding:16px;margin:0 0 24px;'
const MUTED = 'color:#71717a;'

const ITEMS = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 16px;">
  {% for line in order.line_items %}
  <tr>
    <td style="padding:10px 0;border-bottom:1px solid #e4e4e7;vertical-align:middle;">
      {% if line.image_url %}<img src="{{ line.image_url }}" alt="" width="48" height="48" style="border-radius:4px;object-fit:cover;vertical-align:middle;margin-right:12px;">{% endif %}
      {{ line.title }}{% if line.variant_title %} <span style="${MUTED}">· {{ line.variant_title }}</span>{% endif %} × {{ line.quantity }}
    </td>
    <td align="right" style="padding:10px 0;border-bottom:1px solid #e4e4e7;vertical-align:middle;white-space:nowrap;">{{ line.line_price | money }}</td>
  </tr>
  {% endfor %}
</table>`

const TOTALS = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:0 0 8px;">
  <tr><td style="padding:2px 0;${MUTED}">Subtotal</td><td align="right">{{ order.subtotal_price | money }}</td></tr>
  {% if order.total_discounts > 0 %}<tr><td style="padding:2px 0;${MUTED}">Discount{% if order.discount_codes.size > 0 %} ({{ order.discount_codes | join: ', ' }}){% endif %}</td><td align="right">−{{ order.total_discounts | money }}</td></tr>{% endif %}
  {% if order.shipping_method %}<tr><td style="padding:2px 0;${MUTED}">Shipping ({{ order.shipping_method.title }})</td><td align="right">{{ order.shipping_price | money }}</td></tr>{% endif %}
  {% if order.total_tax > 0 %}<tr><td style="padding:2px 0;${MUTED}">{% if order.taxes_included %}Including tax{% else %}Tax{% endif %}</td><td align="right">{{ order.total_tax | money }}</td></tr>{% endif %}
  <tr><td style="padding:10px 0 0;font-size:16px;font-weight:600;">Total</td><td align="right" style="padding:10px 0 0;font-size:16px;font-weight:600;">{{ order.total_price | money }}</td></tr>
</table>`

const ADDRESS = `{% if order.shipping_address %}
<h2 style="font-size:15px;margin:24px 0 4px;">Shipping address</h2>
<p style="margin:0;color:#3f3f46;">
  {{ order.shipping_address.name }}<br>
  {% if order.shipping_address.company %}{{ order.shipping_address.company }}<br>{% endif %}
  {{ order.shipping_address.address1 }}{% if order.shipping_address.address2 %}, {{ order.shipping_address.address2 }}{% endif %}<br>
  {{ order.shipping_address.city }}{% if order.shipping_address.province %}, {{ order.shipping_address.province }}{% endif %} {{ order.shipping_address.zip }}<br>
  {{ order.shipping_address.country }}
</p>
{% endif %}`

const LAYOUT = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{ subject }}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;text-align:left;">
          <tr>
            <td style="padding:24px 32px;border-bottom:1px solid #e4e4e7;">
              {% if shop.logo_url %}<img src="{{ shop.logo_url }}" alt="{{ shop.name }}" height="40" style="display:block;height:40px;width:auto;">{% else %}<strong style="font-size:18px;">{{ shop.name }}</strong>{% endif %}
            </td>
          </tr>
          <tr>
            <td style="padding:32px;font-size:15px;line-height:1.5;">
              {{ content_for_layout }}
            </td>
          </tr>
        </table>
        <p style="font-size:12px;${MUTED}margin:16px 0 0;">
          {{ shop.name }}{% if shop.url %} · <a href="{{ shop.url }}" style="${MUTED}">{{ shop.url | remove: 'https://' | remove: 'http://' }}</a>{% endif %}
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
`

const ORDER_CONFIRMATION = `<h1 style="font-size:22px;margin:0 0 8px;">Thank you for your order!</h1>
<p style="margin:0 0 24px;">Hi {{ order.customer.first_name | default: 'there' }}, we've received order {{ order.name }} and are getting it ready.</p>

{% if order.financial_status == 'pending' and order.payment_instructions %}
<div style="${BOX}">
  <strong>How to pay{% if order.payment_method %} ({{ order.payment_method }}){% endif %}</strong><br>
  {{ order.payment_instructions | newline_to_br }}
</div>
{% endif %}

${ITEMS}
${TOTALS}
${ADDRESS}
`

const SHIPPING_CONFIRMATION = `<h1 style="font-size:22px;margin:0 0 8px;">Your order is on its way</h1>
<p style="margin:0 0 24px;">Hi {{ order.customer.first_name | default: 'there' }}, order {{ order.name }} has shipped.</p>

{% if fulfillment.tracking_number or fulfillment.tracking_url %}
<div style="${BOX}">
  {% if fulfillment.tracking_number %}
  {% if fulfillment.tracking_company %}{{ fulfillment.tracking_company }} tracking number{% else %}Tracking number{% endif %}: <strong>{{ fulfillment.tracking_number }}</strong><br>
  {% endif %}
  {% if fulfillment.tracking_url %}<a href="{{ fulfillment.tracking_url }}" style="${BUTTON}margin-top:12px;">Track your package</a>{% endif %}
</div>
{% endif %}

${ITEMS}
${ADDRESS}
`

const ORDER_CANCELLED = `<h1 style="font-size:22px;margin:0 0 8px;">Your order has been cancelled</h1>
<p style="margin:0 0 24px;">
  Hi {{ order.customer.first_name | default: 'there' }}, order {{ order.name }} was cancelled{% case order.cancel_reason %}{% when 'customer' %} at your request{% when 'inventory' %} because some items are no longer in stock{% when 'declined' %} because the payment was declined{% endcase %}.
  {% if order.financial_status == 'paid' or order.financial_status == 'partially_paid' or order.financial_status == 'refunded' %}Your payment is being refunded to the way you paid.{% endif %}
</p>

${ITEMS}
${TOTALS}
`

const STAFF_ORDER = `<h1 style="font-size:22px;margin:0 0 8px;">New order {{ order.name }}</h1>
<p style="margin:0 0 24px;">
  {{ order.customer.name | default: order.email }} placed an order for {{ order.total_price | money }}{% if order.financial_status == 'pending' %}, awaiting payment{% if order.payment_method %} by {{ order.payment_method }}{% endif %}{% endif %}.
</p>
<p style="margin:0 0 24px;"><a href="{{ order.admin_url }}" style="${BUTTON}">View order</a></p>

${ITEMS}
${TOTALS}
{% if order.note %}
<h2 style="font-size:15px;margin:24px 0 4px;">Note from the customer</h2>
<p style="margin:0;color:#3f3f46;">{{ order.note | newline_to_br }}</p>
{% endif %}
${ADDRESS}
`

const LOGIN_CODE = `<h1 style="font-size:22px;margin:0 0 8px;">Your sign-in code</h1>
<p style="margin:0 0 24px;">Enter this code to sign in to {{ shop.name }}. It expires in {{ expires_in_minutes }} minutes.</p>
<div style="${BOX}text-align:center;font-size:32px;font-weight:700;letter-spacing:8px;">{{ code }}</div>
<p style="margin:0;${MUTED}font-size:13px;">If you didn't ask for this code, you can ignore this email.</p>
`

export const DEFAULTS: Record<Notification, { subject: string; body: string }> = {
  order_confirmation: { subject: 'Order {{ order.name }} confirmed', body: ORDER_CONFIRMATION },
  shipping_confirmation: { subject: 'Order {{ order.name }} is on its way', body: SHIPPING_CONFIRMATION },
  order_cancelled: { subject: 'Order {{ order.name }} has been cancelled', body: ORDER_CANCELLED },
  staff_order: {
    subject: '[{{ shop.name }}] New order {{ order.name }} ({{ order.total_price | money }})',
    body: STAFF_ORDER,
  },
  login_code: { subject: '{{ code }} is your {{ shop.name }} sign-in code', body: LOGIN_CODE },
  // Its "subject" is never sent: the layout only wraps the other notifications
  layout: { subject: '', body: LAYOUT },
}
