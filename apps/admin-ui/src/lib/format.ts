export function formatDate(date: Date | string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(date))
}

// Order name as shown everywhere (Shopify style): #1001
export function orderName(orderNumber: number) {
  return `#${orderNumber}`
}

export function formatDateTime(date: Date | string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date))
}
