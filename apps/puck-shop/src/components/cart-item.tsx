"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Minus, Plus, Trash2, Heart } from "lucide-react"
import Link from "next/link"

interface CartItemProps {
  item: {
    id: string
    name: string
    brand: string
    price: number
    originalPrice?: number
    image: string
    quantity: number
    color: string
    inStock: boolean
  }
  onUpdateQuantity: (id: string, quantity: number) => void
  onRemove: (id: string) => void
}

export function CartItem({ item, onUpdateQuantity, onRemove }: CartItemProps) {
  const discount = item.originalPrice ? Math.round(((item.originalPrice - item.price) / item.originalPrice) * 100) : 0

  return (
    <div className="p-6">
      <div className="flex gap-4">
        {/* Product Image */}
        <div className="flex-shrink-0">
          <Link href={`/products/${item.id}`}>
            <img
              src={item.image || "/placeholder.svg"}
              alt={item.name}
              className="h-24 w-24 rounded-lg object-cover border"
            />
          </Link>
        </div>

        {/* Product Details */}
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-start mb-2">
            <div>
              <p className="text-sm text-muted-foreground">{item.brand}</p>
              <Link href={`/products/${item.id}`} className="hover:text-primary transition-colors">
                <h3 className="font-medium text-sm line-clamp-2">{item.name}</h3>
              </Link>
              <p className="text-sm text-muted-foreground mt-1">Color: {item.color}</p>
            </div>

            <Button variant="ghost" size="sm" onClick={() => onRemove(item.id)} className="text-muted-foreground">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          {/* Stock Status */}
          <div className="flex items-center gap-2 mb-3">
            <div className={`h-2 w-2 rounded-full ${item.inStock ? "bg-green-500" : "bg-red-500"}`} />
            <span className={`text-xs font-medium ${item.inStock ? "text-green-600" : "text-red-600"}`}>
              {item.inStock ? "In Stock" : "Out of Stock"}
            </span>
          </div>

          {/* Price and Quantity */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-semibold">${item.price.toFixed(2)}</span>
              {item.originalPrice && (
                <>
                  <span className="text-sm text-muted-foreground line-through">${item.originalPrice.toFixed(2)}</span>
                  <Badge variant="secondary" className="text-xs">
                    -{discount}%
                  </Badge>
                </>
              )}
            </div>

            <div className="flex items-center gap-3">
              {/* Quantity Controls */}
              <div className="flex items-center border rounded-md">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
                  disabled={item.quantity <= 1}
                  className="h-8 w-8 p-0"
                >
                  <Minus className="h-3 w-3" />
                </Button>
                <span className="px-3 py-1 text-sm min-w-[40px] text-center">{item.quantity}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                  disabled={!item.inStock}
                  className="h-8 w-8 p-0"
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              {/* Save for Later */}
              <Button variant="ghost" size="sm" className="text-muted-foreground">
                <Heart className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Item Total */}
          <div className="mt-2 text-right">
            <span className="text-sm text-muted-foreground">Item total: </span>
            <span className="font-semibold">${(item.price * item.quantity).toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
