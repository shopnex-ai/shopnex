"use client"

import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { CartItem } from "@/components/cart-item"
import { OrderSummary } from "@/components/order-summary"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { ShoppingBag, ArrowRight } from "lucide-react"
import { useState } from "react"
import Link from "next/link"

// Sample cart data
const initialCartItems = [
  {
    id: "1",
    name: "Wireless Bluetooth Headphones with Active Noise Cancellation",
    brand: "AudioTech",
    price: 89.99,
    originalPrice: 129.99,
    image: "/wireless-bluetooth-headphones.png",
    quantity: 1,
    color: "Black",
    inStock: true,
  },
  {
    id: "2",
    name: "Smart Fitness Watch with Heart Rate Monitor",
    brand: "FitPro",
    price: 199.99,
    originalPrice: 249.99,
    image: "/smart-fitness-watch.png",
    quantity: 2,
    color: "Blue",
    inStock: true,
  },
  {
    id: "3",
    name: "Premium Coffee Maker with Grinder",
    brand: "BrewMaster",
    price: 159.99,
    image: "/premium-coffee-maker.png",
    quantity: 1,
    color: "Silver",
    inStock: false,
  },
]

export default function CartPage() {
  const [cartItems, setCartItems] = useState(initialCartItems)

  const updateQuantity = (id: string, newQuantity: number) => {
    if (newQuantity === 0) {
      setCartItems(cartItems.filter((item) => item.id !== id))
    } else {
      setCartItems(cartItems.map((item) => (item.id === id ? { ...item, quantity: newQuantity } : item)))
    }
  }

  const removeItem = (id: string) => {
    setCartItems(cartItems.filter((item) => item.id !== id))
  }

  const subtotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const savings = cartItems.reduce(
    (sum, item) => sum + (item.originalPrice ? (item.originalPrice - item.price) * item.quantity : 0),
    0,
  )

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto px-4 py-8">
        {/* Breadcrumb */}
        <Breadcrumb className="mb-6">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Shopping Cart</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Page Header */}
        <div className="flex items-center gap-3 mb-8">
          <ShoppingBag className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-heading font-bold">Shopping Cart</h1>
          <span className="text-muted-foreground">({cartItems.length} items)</span>
        </div>

        {cartItems.length === 0 ? (
          /* Empty Cart */
          <div className="text-center py-16">
            <ShoppingBag className="h-24 w-24 text-muted-foreground mx-auto mb-6" />
            <h2 className="text-2xl font-heading font-semibold mb-4">Your cart is empty</h2>
            <p className="text-muted-foreground mb-8 max-w-md mx-auto">
              Looks like you haven't added any items to your cart yet. Start shopping to fill it up!
            </p>
            <Button asChild size="lg">
              <Link href="/">Continue Shopping</Link>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Cart Items */}
            <div className="lg:col-span-2 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Items in Your Cart</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {cartItems.map((item) => (
                      <CartItem key={item.id} item={item} onUpdateQuantity={updateQuantity} onRemove={removeItem} />
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Continue Shopping */}
              <div className="flex justify-between items-center">
                <Button variant="outline" asChild>
                  <Link href="/">Continue Shopping</Link>
                </Button>
                {savings > 0 && (
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">You're saving</p>
                    <p className="text-lg font-semibold text-green-600">${savings.toFixed(2)}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Order Summary */}
            <div className="lg:col-span-1">
              <div className="sticky top-24">
                <OrderSummary
                  subtotal={subtotal}
                  savings={savings}
                  itemCount={cartItems.reduce((sum, item) => sum + item.quantity, 0)}
                />
                <div className="mt-6 space-y-3">
                  <Button asChild size="lg" className="w-full">
                    <Link href="/checkout">
                      Proceed to Checkout
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                  <Button variant="outline" size="lg" className="w-full bg-transparent">
                    Save for Later
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <Footer />
    </div>
  )
}
