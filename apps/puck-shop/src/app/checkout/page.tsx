"use client"

import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { CheckoutProgress } from "@/components/checkout-progress"
import { ShippingForm } from "@/components/shipping-form"
import { PaymentForm } from "@/components/payment-form"
import { OrderReview } from "@/components/order-review"
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
import { Lock, ArrowLeft } from "lucide-react"
import { useState } from "react"
import Link from "next/link"

const steps = [
  { id: 1, name: "Shipping", description: "Delivery information" },
  { id: 2, name: "Payment", description: "Payment method" },
  { id: 3, name: "Review", description: "Review your order" },
]

// Sample order data
const orderData = {
  subtotal: 549.97,
  savings: 89.98,
  itemCount: 4,
  items: [
    {
      id: "1",
      name: "Wireless Bluetooth Headphones",
      price: 89.99,
      quantity: 1,
      image: "/wireless-bluetooth-headphones.png",
    },
    {
      id: "2",
      name: "Smart Fitness Watch",
      price: 199.99,
      quantity: 2,
      image: "/smart-fitness-watch.png",
    },
  ],
}

export default function CheckoutPage() {
  const [currentStep, setCurrentStep] = useState(1)
  const [shippingData, setShippingData] = useState({})
  const [paymentData, setPaymentData] = useState({})

  const nextStep = () => {
    if (currentStep < steps.length) {
      setCurrentStep(currentStep + 1)
    }
  }

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return <ShippingForm onNext={nextStep} onDataChange={setShippingData} />
      case 2:
        return <PaymentForm onNext={nextStep} onPrev={prevStep} onDataChange={setPaymentData} />
      case 3:
        return (
          <OrderReview shippingData={shippingData} paymentData={paymentData} orderData={orderData} onPrev={prevStep} />
        )
      default:
        return null
    }
  }

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
              <BreadcrumbLink href="/cart">Cart</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Checkout</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Security Badge */}
        <div className="flex items-center justify-center gap-2 mb-8 p-4 bg-muted/30 rounded-lg">
          <Lock className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium">Secure Checkout - Your information is protected</span>
        </div>

        {/* Progress Indicator */}
        <CheckoutProgress steps={steps} currentStep={currentStep} className="mb-8" />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Checkout Form */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
                    {currentStep}
                  </span>
                  {steps[currentStep - 1].name}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-10 space-y-8">
                <div className="[&_label]:text-sm [&_label]:font-medium [&_label]:mb-3 [&_label]:block [&_input]:mt-2 [&_input]:h-12 [&_input]:text-base [&_select]:mt-2 [&_select]:h-12 [&_textarea]:mt-2 [&_textarea]:min-h-[100px] [&_.form-item]:mb-6">
                  {renderStepContent()}
                </div>
              </CardContent>
            </Card>

            {/* Back to Cart */}
            <div className="mt-6">
              <Button variant="outline" asChild>
                <Link href="/cart">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Cart
                </Link>
              </Button>
            </div>
          </div>

          {/* Order Summary */}
          <div className="lg:col-span-1">
            <div className="sticky top-24">
              <OrderSummary
                subtotal={orderData.subtotal}
                savings={orderData.savings}
                itemCount={orderData.itemCount}
                showItems={true}
                items={orderData.items}
              />
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
