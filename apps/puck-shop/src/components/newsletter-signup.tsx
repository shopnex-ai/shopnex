"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Mail, Gift } from "lucide-react"

export function NewsletterSignup() {
  const [email, setEmail] = useState("")
  const [isSubscribed, setIsSubscribed] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Handle newsletter signup
    setIsSubscribed(true)
    setEmail("")
  }

  if (isSubscribed) {
    return (
      <Card className="bg-gradient-to-r from-primary/10 to-secondary/10 border-primary/20">
        <CardContent className="p-6 text-center">
          <Gift className="h-12 w-12 text-primary mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">Welcome to ShopNex!</h3>
          <p className="text-muted-foreground">Thank you for subscribing! Check your email for a 15% off coupon.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="bg-gradient-to-r from-primary/5 to-secondary/5">
      <CardContent className="p-6">
        <div className="text-center mb-4">
          <Mail className="h-8 w-8 text-primary mx-auto mb-2" />
          <h3 className="text-lg font-semibold mb-1">Get 15% Off Your First Order</h3>
          <p className="text-sm text-muted-foreground">Subscribe to our newsletter for exclusive deals and updates</p>
        </div>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            type="email"
            placeholder="Enter your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="flex-1"
          />
          <Button type="submit" className="shrink-0">
            Subscribe
          </Button>
        </form>
        <p className="text-xs text-muted-foreground mt-2 text-center">Unsubscribe anytime. We respect your privacy.</p>
      </CardContent>
    </Card>
  )
}
