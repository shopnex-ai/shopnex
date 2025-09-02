"use client"

import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Clock, Flame } from "lucide-react"
import Image from "next/image"
import Link from "next/link"

const flashDeals = [
  {
    id: "1",
    name: "Wireless Gaming Mouse",
    originalPrice: 79.99,
    salePrice: 39.99,
    discount: 50,
    image: "/gaming-mouse.png",
    stock: 12,
    sold: 88,
  },
  {
    id: "2",
    name: "Bluetooth Speaker",
    originalPrice: 149.99,
    salePrice: 89.99,
    discount: 40,
    image: "/bluetooth-speaker.png",
    stock: 8,
    sold: 142,
  },
  {
    id: "3",
    name: "USB-C Hub",
    originalPrice: 59.99,
    salePrice: 29.99,
    discount: 50,
    image: "/usb-hub.png",
    stock: 15,
    sold: 67,
  },
]

export function FlashDeals() {
  const [timeLeft, setTimeLeft] = useState({
    hours: 23,
    minutes: 45,
    seconds: 30,
  })

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev.seconds > 0) {
          return { ...prev, seconds: prev.seconds - 1 }
        } else if (prev.minutes > 0) {
          return { ...prev, minutes: prev.minutes - 1, seconds: 59 }
        } else if (prev.hours > 0) {
          return { hours: prev.hours - 1, minutes: 59, seconds: 59 }
        }
        return prev
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  return (
    <section className="py-12 bg-gradient-to-r from-red-50 to-orange-50">
      <div className="container mx-auto px-4">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Flame className="h-8 w-8 text-red-500" />
            <h2 className="text-3xl font-bold text-balance">Flash Deals</h2>
          </div>
          <div className="flex items-center justify-center gap-4 mb-4">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <span className="text-lg font-semibold">Ends in:</span>
            <div className="flex gap-2">
              <div className="bg-red-500 text-white px-3 py-1 rounded text-sm font-bold">
                {String(timeLeft.hours).padStart(2, "0")}h
              </div>
              <div className="bg-red-500 text-white px-3 py-1 rounded text-sm font-bold">
                {String(timeLeft.minutes).padStart(2, "0")}m
              </div>
              <div className="bg-red-500 text-white px-3 py-1 rounded text-sm font-bold">
                {String(timeLeft.seconds).padStart(2, "0")}s
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {flashDeals.map((deal) => (
            <Card key={deal.id} className="group hover:shadow-lg transition-shadow">
              <CardContent className="p-4">
                <div className="relative mb-4">
                  <Image
                    src={deal.image || "/placeholder.svg"}
                    alt={deal.name}
                    width={200}
                    height={200}
                    className="w-full h-48 object-cover rounded-lg"
                  />
                  <Badge className="absolute top-2 left-2 bg-red-500 hover:bg-red-600">-{deal.discount}%</Badge>
                </div>
                <h3 className="font-semibold mb-2 text-balance">{deal.name}</h3>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-2xl font-bold text-red-500">${deal.salePrice}</span>
                  <span className="text-sm text-muted-foreground line-through">${deal.originalPrice}</span>
                </div>
                <div className="mb-4">
                  <div className="flex justify-between text-sm text-muted-foreground mb-1">
                    <span>Sold: {deal.sold}</span>
                    <span>Stock: {deal.stock}</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className="bg-red-500 h-2 rounded-full"
                      style={{
                        width: `${(deal.sold / (deal.sold + deal.stock)) * 100}%`,
                      }}
                    />
                  </div>
                </div>
                <Button asChild className="w-full">
                  <Link href={`/products/${deal.id}`}>Buy Now</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}
