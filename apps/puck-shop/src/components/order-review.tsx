"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { ArrowLeft, Check } from "lucide-react"
import { useState } from "react"

interface OrderReviewProps {
  shippingData: any
  paymentData: any
  orderData: any
  onPrev: () => void
}

export function OrderReview({ shippingData, paymentData, orderData, onPrev }: OrderReviewProps) {
  const [isProcessing, setIsProcessing] = useState(false)
  const [orderPlaced, setOrderPlaced] = useState(false)

  const handlePlaceOrder = async () => {
    setIsProcessing(true)
    // Simulate order processing
    await new Promise((resolve) => setTimeout(resolve, 2000))
    setIsProcessing(false)
    setOrderPlaced(true)
  }

  if (orderPlaced) {
    return (
      <div className="text-center py-8">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 mx-auto mb-4">
          <Check className="h-8 w-8 text-green-600" />
        </div>
        <h2 className="text-2xl font-heading font-bold mb-2">Order Placed Successfully!</h2>
        <p className="text-muted-foreground mb-6">
          Thank you for your purchase. You'll receive a confirmation email shortly.
        </p>
        <div className="space-y-2">
          <p className="text-sm">
            <span className="font-medium">Order Number:</span> #SN-2024-001234
          </p>
          <p className="text-sm">
            <span className="font-medium">Estimated Delivery:</span> 3-5 business days
          </p>
        </div>
        <Button className="mt-6">Continue Shopping</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Shipping Information */}
      <Card>
        <CardHeader>
          <CardTitle>Shipping Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <p className="font-medium">
              {shippingData.firstName} {shippingData.lastName}
            </p>
            <p className="text-sm text-muted-foreground">{shippingData.address}</p>
            {shippingData.apartment && <p className="text-sm text-muted-foreground">{shippingData.apartment}</p>}
            <p className="text-sm text-muted-foreground">
              {shippingData.city}, {shippingData.state} {shippingData.zipCode}
            </p>
            <p className="text-sm text-muted-foreground">{shippingData.phone}</p>
          </div>
        </CardContent>
      </Card>

      {/* Payment Information */}
      <Card>
        <CardHeader>
          <CardTitle>Payment Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <p className="font-medium">{paymentData.paymentMethod === "card" ? "Credit Card" : "PayPal"}</p>
            {paymentData.paymentMethod === "card" && (
              <p className="text-sm text-muted-foreground">**** **** **** {paymentData.cardNumber?.slice(-4)}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Order Items */}
      <Card>
        <CardHeader>
          <CardTitle>Order Items</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {orderData.items.map((item: any) => (
              <div key={item.id} className="flex items-center gap-4">
                <img
                  src={item.image || "/placeholder.svg"}
                  alt={item.name}
                  className="h-16 w-16 rounded object-cover border"
                />
                <div className="flex-1">
                  <p className="font-medium">{item.name}</p>
                  <p className="text-sm text-muted-foreground">Quantity: {item.quantity}</p>
                </div>
                <span className="font-medium">${(item.price * item.quantity).toFixed(2)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Order Total */}
      <Card>
        <CardHeader>
          <CardTitle>Order Total</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Subtotal</span>
              <span>${orderData.subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Shipping</span>
              <span>FREE</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Tax</span>
              <span>${(orderData.subtotal * 0.08).toFixed(2)}</span>
            </div>
            <Separator />
            <div className="flex justify-between font-semibold">
              <span>Total</span>
              <span>${(orderData.subtotal + orderData.subtotal * 0.08).toFixed(2)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Navigation Buttons */}
      <div className="flex gap-4">
        <Button type="button" variant="outline" onClick={onPrev} className="flex-1 bg-transparent">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Payment
        </Button>
        <Button onClick={handlePlaceOrder} disabled={isProcessing} className="flex-1">
          {isProcessing ? "Processing..." : "Place Order"}
        </Button>
      </div>
    </div>
  )
}
