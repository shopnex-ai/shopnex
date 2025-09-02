"use client"

import type React from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, ArrowRight, CreditCard, Smartphone } from "lucide-react"
import { useState } from "react"

interface PaymentFormProps {
  onNext: () => void
  onPrev: () => void
  onDataChange: (data: any) => void
}

export function PaymentForm({ onNext, onPrev, onDataChange }: PaymentFormProps) {
  const [formData, setFormData] = useState({
    paymentMethod: "card",
    cardNumber: "",
    expiryDate: "",
    cvv: "",
    nameOnCard: "",
    billingAddressSame: true,
    billingAddress: {
      address: "",
      city: "",
      state: "",
      zipCode: "",
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onDataChange(formData)
    onNext()
  }

  const updateFormData = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const updateBillingAddress = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      billingAddress: { ...prev.billingAddress, [field]: value },
    }))
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Payment Method */}
      <Card>
        <CardHeader>
          <CardTitle>Payment Method</CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup value={formData.paymentMethod} onValueChange={(value) => updateFormData("paymentMethod", value)}>
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="card" id="card" />
                <Label htmlFor="card" className="cursor-pointer flex items-center gap-2">
                  <CreditCard className="h-4 w-4" />
                  Credit or Debit Card
                </Label>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="paypal" id="paypal" />
                <Label htmlFor="paypal" className="cursor-pointer flex items-center gap-2">
                  <Smartphone className="h-4 w-4" />
                  PayPal
                </Label>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="apple" id="apple" />
                <Label htmlFor="apple" className="cursor-pointer flex items-center gap-2">
                  <Smartphone className="h-4 w-4" />
                  Apple Pay
                </Label>
              </div>
            </div>
          </RadioGroup>
        </CardContent>
      </Card>

      {/* Card Details */}
      {formData.paymentMethod === "card" && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Card Information</h3>

          <div>
            <Label htmlFor="cardNumber">Card Number</Label>
            <Input
              id="cardNumber"
              value={formData.cardNumber}
              onChange={(e) => updateFormData("cardNumber", e.target.value)}
              placeholder="1234 5678 9012 3456"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="expiryDate">Expiry Date</Label>
              <Input
                id="expiryDate"
                value={formData.expiryDate}
                onChange={(e) => updateFormData("expiryDate", e.target.value)}
                placeholder="MM/YY"
                required
              />
            </div>
            <div>
              <Label htmlFor="cvv">CVV</Label>
              <Input
                id="cvv"
                value={formData.cvv}
                onChange={(e) => updateFormData("cvv", e.target.value)}
                placeholder="123"
                required
              />
            </div>
          </div>

          <div>
            <Label htmlFor="nameOnCard">Name on Card</Label>
            <Input
              id="nameOnCard"
              value={formData.nameOnCard}
              onChange={(e) => updateFormData("nameOnCard", e.target.value)}
              placeholder="John Doe"
              required
            />
          </div>
        </div>
      )}

      {/* Billing Address */}
      <div className="space-y-4">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="billingAddressSame"
            checked={formData.billingAddressSame}
            onCheckedChange={(checked) => updateFormData("billingAddressSame", checked)}
          />
          <Label htmlFor="billingAddressSame" className="cursor-pointer">
            Billing address is the same as shipping address
          </Label>
        </div>

        {!formData.billingAddressSame && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Billing Address</h3>

            <div>
              <Label htmlFor="billingAddress">Address</Label>
              <Input
                id="billingAddress"
                value={formData.billingAddress.address}
                onChange={(e) => updateBillingAddress("address", e.target.value)}
                placeholder="123 Main Street"
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="billingCity">City</Label>
                <Input
                  id="billingCity"
                  value={formData.billingAddress.city}
                  onChange={(e) => updateBillingAddress("city", e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="billingState">State</Label>
                <Input
                  id="billingState"
                  value={formData.billingAddress.state}
                  onChange={(e) => updateBillingAddress("state", e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="billingZipCode">ZIP Code</Label>
                <Input
                  id="billingZipCode"
                  value={formData.billingAddress.zipCode}
                  onChange={(e) => updateBillingAddress("zipCode", e.target.value)}
                  required
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Navigation Buttons */}
      <div className="flex gap-4">
        <Button type="button" variant="outline" onClick={onPrev} className="flex-1 bg-transparent">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Shipping
        </Button>
        <Button type="submit" className="flex-1">
          Review Order
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </form>
  )
}
