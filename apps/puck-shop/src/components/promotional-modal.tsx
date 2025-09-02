"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Gift, Sparkles } from "lucide-react"

export function PromotionalModal() {
  const [isOpen, setIsOpen] = useState(false)
  const [email, setEmail] = useState("")

  useEffect(() => {
    // Show modal after 3 seconds if user hasn't seen it before
    const hasSeenModal = localStorage.getItem("shopnex-promo-modal-seen")
    if (!hasSeenModal) {
      const timer = setTimeout(() => {
        setIsOpen(true)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [])

  const handleClose = () => {
    setIsOpen(false)
    localStorage.setItem("shopnex-promo-modal-seen", "true")
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Handle email signup
    handleClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-center justify-center">
            <Gift className="h-6 w-6 text-primary" />
            Welcome to ShopNex!
          </DialogTitle>
        </DialogHeader>

        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="relative">
              <Sparkles className="h-16 w-16 text-primary" />
              <div className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full">
                20%
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-xl font-semibold mb-2">Get 20% Off Your First Order!</h3>
            <p className="text-muted-foreground text-sm">
              Join thousands of happy customers and get exclusive access to deals and new arrivals.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <Input
              type="email"
              placeholder="Enter your email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Button type="submit" className="w-full">
              Claim My 20% Discount
            </Button>
          </form>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>No spam, unsubscribe anytime</span>
            <Button variant="ghost" size="sm" onClick={handleClose} className="text-xs p-0 h-auto">
              No thanks
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
