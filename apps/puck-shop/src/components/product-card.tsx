import { Heart, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

interface ProductCardProps {
  id: string
  name: string
  price: number
  originalPrice?: number
  rating: number
  reviewCount: number
  image: string
  badge?: string
  isWishlisted?: boolean
}

export function ProductCard({
  id,
  name,
  price,
  originalPrice,
  rating,
  reviewCount,
  image,
  badge,
  isWishlisted = false,
}: ProductCardProps) {
  const discount = originalPrice ? Math.round(((originalPrice - price) / originalPrice) * 100) : 0

  return (
    <Card className="group relative overflow-hidden border-border hover:shadow-lg transition-all duration-300">
      <div className="relative aspect-square overflow-hidden">
        <img
          src={image || "/placeholder.svg"}
          alt={name}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />

        {badge && <Badge className="absolute top-2 left-2 bg-destructive text-destructive-foreground">{badge}</Badge>}

        {discount > 0 && (
          <Badge className="absolute top-2 right-2 bg-secondary text-secondary-foreground">-{discount}%</Badge>
        )}

        <Button
          variant="ghost"
          size="icon"
          className={`absolute top-2 right-2 ${badge ? "top-12" : ""} opacity-0 group-hover:opacity-100 transition-opacity bg-background/80 hover:bg-background ${
            isWishlisted ? "text-destructive" : ""
          }`}
        >
          <Heart className={`h-4 w-4 ${isWishlisted ? "fill-current" : ""}`} />
        </Button>
      </div>

      <CardContent className="p-4">
        <h3 className="font-medium text-sm mb-2 line-clamp-2 text-balance">{name}</h3>

        <div className="flex items-center gap-1 mb-2">
          <div className="flex items-center">
            {[...Array(5)].map((_, i) => (
              <Star
                key={i}
                className={`h-3 w-3 ${
                  i < Math.floor(rating) ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"
                }`}
              />
            ))}
          </div>
          <span className="text-xs text-muted-foreground">({reviewCount})</span>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg font-semibold text-foreground">${price.toFixed(2)}</span>
          {originalPrice && (
            <span className="text-sm text-muted-foreground line-through">${originalPrice.toFixed(2)}</span>
          )}
        </div>

        <Button className="w-full" size="sm">
          Add to Cart
        </Button>
      </CardContent>
    </Card>
  )
}
