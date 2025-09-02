"use client"

import type React from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowRight, Truck } from "lucide-react"
import { useState } from "react"

interface ShippingFormProps {
  onNext: () => void
  onDataChange: (data: any) => void
}

export function ShippingForm({ onNext, onDataChange }: ShippingFormProps) {
  const [formData, setFormData] = useState({
    email: "",
    firstName: "",
    lastName: "",
    address: "",
    apartment: "",
    city: "",
    state: "",
    zipCode: "",
    phone: "",
    shippingMethod: "standard",
    saveInfo: false,
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onDataChange(formData)
    onNext()
  }

  const updateFormData = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Contact Information */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Contact Information</h3>
        <div>
          <Label htmlFor="email">Email Address</Label>
          <Input
            id="email"
            type="email"
            value={formData.email}
            onChange={(e) => updateFormData("email", e.target.value)}
            placeholder="your@email.com"
            required
          />
        </div>
      </div>

      {/* Shipping Address */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Shipping Address</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="firstName">First Name</Label>
            <Input
              id="firstName"
              value={formData.firstName}
              onChange={(e) => updateFormData("firstName", e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="lastName">Last Name</Label>
            <Input
              id="lastName"
              value={formData.lastName}
              onChange={(e) => updateFormData("lastName", e.target.value)}
              required
            />
          </div>
        </div>

        <div>
          <Label htmlFor="address">Address</Label>
          <Input
            id="address"
            value={formData.address}
            onChange={(e) => updateFormData("address", e.target.value)}
            placeholder="123 Main Street"
            required
          />
        </div>

        <div>
          <Label htmlFor="apartment">Apartment, suite, etc. (optional)</Label>
          <Input
            id="apartment"
            value={formData.apartment}
            onChange={(e) => updateFormData("apartment", e.target.value)}
            placeholder="Apt 4B"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label htmlFor="city">City</Label>
            <Input id="city" value={formData.city} onChange={(e) => updateFormData("city", e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="state">State</Label>
            <Input
              id="state"
              value={formData.state}
              onChange={(e) => updateFormData("state", e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="zipCode">ZIP Code</Label>
            <Input
              id="zipCode"
              value={formData.zipCode}
              onChange={(e) => updateFormData("zipCode", e.target.value)}
              required
            />
          </div>
        </div>

        <div>
          <Label htmlFor="phone">Phone Number</Label>
          <Input
            id="phone"
            type="tel"
            value={formData.phone}
            onChange={(e) => updateFormData("phone", e.target.value)}
            placeholder="(555) 123-4567"
            required
          />
        </div>
      </div>

      {/* Shipping Method */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            Shipping Method
          </CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={formData.shippingMethod}
            onValueChange={(value) => updateFormData("shippingMethod", value)}
          >
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="standard" id="standard" />
                <Label htmlFor="standard" className="cursor-pointer">
                  <div>
                    <p className="font-medium">Standard Shipping</p>
                    <p className="text-sm text-muted-foreground">5-7 business days</p>
                  </div>
                </Label>
              </div>
              <span className="font-medium">FREE</span>
            </div>

            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="express" id="express" />
                <Label htmlFor="express" className="cursor-pointer">
                  <div>
                    <p className="font-medium">Express Shipping</p>
                    <p className="text-sm text-muted-foreground">2-3 business days</p>
                  </div>
                </Label>
              </div>
              <span className="font-medium">$9.99</span>
            </div>

            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="overnight" id="overnight" />
                <Label htmlFor="overnight" className="cursor-pointer">
                  <div>
                    <p className="font-medium">Overnight Shipping</p>
                    <p className="text-sm text-muted-foreground">Next business day</p>
                  </div>
                </Label>
              </div>
              <span className="font-medium">$24.99</span>
            </div>
          </RadioGroup>
        </CardContent>
      </Card>

      {/* Save Information */}
      <div className="flex items-center space-x-2">
        <Checkbox
          id="saveInfo"
          checked={formData.saveInfo}
          onCheckedChange={(checked) => updateFormData("saveInfo", checked)}
        />
        <Label htmlFor="saveInfo" className="text-sm cursor-pointer">
          Save this information for next time
        </Label>
      </div>

      {/* Continue Button */}
      <Button type="submit" size="lg" className="w-full">
        Continue to Payment
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </form>
  )
}
