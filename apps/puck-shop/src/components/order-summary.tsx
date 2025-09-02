import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Truck, Shield } from "lucide-react"

interface OrderSummaryProps {
  subtotal: number
  savings?: number
  itemCount: number
  showItems?: boolean
  items?: Array<{
    id: string
    name: string
    price: number
    quantity: number
    image: string
  }>
}

export function OrderSummary({ subtotal, savings = 0, itemCount, showItems = false, items = [] }: OrderSummaryProps) {
  const shipping = subtotal > 50 ? 0 : 9.99
  const tax = subtotal * 0.08 // 8% tax
  const total = subtotal + shipping + tax

  return (
    <Card>
      <CardHeader>
        <CardTitle>Order Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Items Preview */}
        {showItems && items.length > 0 && (
          <div className="space-y-3">
            {items.map((item) => (
              <div key={item.id} className="flex items-center gap-3">
                <img
                  src={item.image || "/placeholder.svg"}
                  alt={item.name}
                  className="h-12 w-12 rounded object-cover border"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium line-clamp-1">{item.name}</p>
                  <p className="text-xs text-muted-foreground">Qty: {item.quantity}</p>
                </div>
                <span className="text-sm font-medium">${(item.price * item.quantity).toFixed(2)}</span>
              </div>
            ))}
            <Separator />
          </div>
        )}

        {/* Pricing Breakdown */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Subtotal ({itemCount} items)</span>
            <span>${subtotal.toFixed(2)}</span>
          </div>

          {savings > 0 && (
            <div className="flex justify-between text-sm text-green-600">
              <span>Savings</span>
              <span>-${savings.toFixed(2)}</span>
            </div>
          )}

          <div className="flex justify-between text-sm">
            <span>Shipping</span>
            <span>{shipping === 0 ? "FREE" : `$${shipping.toFixed(2)}`}</span>
          </div>

          <div className="flex justify-between text-sm">
            <span>Tax</span>
            <span>${tax.toFixed(2)}</span>
          </div>

          <Separator />

          <div className="flex justify-between font-semibold">
            <span>Total</span>
            <span>${total.toFixed(2)}</span>
          </div>
        </div>

        {/* Shipping Benefits */}
        <div className="space-y-2 pt-4 border-t">
          <div className="flex items-center gap-2 text-sm">
            <Truck className="h-4 w-4 text-primary" />
            <span>{shipping === 0 ? "Free shipping included" : "Free shipping on orders over $50"}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Shield className="h-4 w-4 text-primary" />
            <span>Secure checkout guaranteed</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
