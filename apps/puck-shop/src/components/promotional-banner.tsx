"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { X, Truck, Percent, Clock } from "lucide-react"
import Link from "next/link"

export function PromotionalBanner() {
  const [isVisible, setIsVisible] = useState(true)

  if (!isVisible) return null

  return (
    <div className="bg-gradient-to-r from-primary to-primary/80 text-primary-foreground">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6 text-sm font-medium">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4" />
              <span>Free shipping on orders over $50</span>
            </div>
            <div className="hidden md:flex items-center gap-2">
              <Percent className="h-4 w-4" />
              <span>Up to 70% off selected items</span>
            </div>
            <div className="hidden lg:flex items-center gap-2">
              <Clock className="h-4 w-4" />
              <span>Flash Sale ends in 2 days!</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" asChild>
              <Link href="/categories/electronics">Shop Now</Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsVisible(false)}
              className="text-primary-foreground hover:bg-primary-foreground/20"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
