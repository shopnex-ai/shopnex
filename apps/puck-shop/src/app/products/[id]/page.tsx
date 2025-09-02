"use client"

import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { ProductImageGallery } from "@/components/product-image-gallery"
import { ProductReviews } from "@/components/product-reviews"
import { RelatedProducts } from "@/components/related-products"
import { ProductSpecs } from "@/components/product-specs"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Heart, Share2, Star, Truck, Shield, RotateCcw, Minus, Plus } from "lucide-react"
import { useState } from "react"

// Sample product data
const productData = {
  id: "1",
  name: "Wireless Bluetooth Headphones with Active Noise Cancellation",
  brand: "AudioTech",
  price: 89.99,
  originalPrice: 129.99,
  rating: 4.5,
  reviewCount: 1247,
  inStock: true,
  stockCount: 23,
  description:
    "Experience premium sound quality with our advanced wireless headphones featuring active noise cancellation technology. Perfect for music lovers, commuters, and professionals who demand the best audio experience.",
  features: [
    "Active Noise Cancellation Technology",
    "30-hour battery life with quick charge",
    "Premium comfort with memory foam ear cups",
    "Bluetooth 5.0 connectivity",
    "Built-in microphone for calls",
    "Foldable design for easy storage",
  ],
  images: [
    "/wireless-bluetooth-headphones.png",
    "/placeholder.svg?key=headphones2",
    "/placeholder.svg?key=headphones3",
    "/placeholder.svg?key=headphones4",
  ],
  variants: {
    color: ["Black", "White", "Blue", "Red"],
    size: ["Standard"],
  },
  category: "Electronics",
  subcategory: "Headphones",
}

interface ProductPageProps {
  params: {
    id: string
  }
}

export default function ProductPage({ params }: ProductPageProps) {
  const [selectedColor, setSelectedColor] = useState(productData.variants.color[0])
  const [quantity, setQuantity] = useState(1)
  const [isWishlisted, setIsWishlisted] = useState(false)

  const discount = Math.round(((productData.originalPrice - productData.price) / productData.originalPrice) * 100)

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
              <BreadcrumbLink href="/categories">Categories</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href={`/categories/${productData.category.toLowerCase()}`}>
                {productData.category}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{productData.name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Product Details */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mb-16">
          {/* Product Images */}
          <div>
            <ProductImageGallery images={productData.images} productName={productData.name} />
          </div>

          {/* Product Info */}
          <div className="space-y-6">
            {/* Brand and Title */}
            <div>
              <p className="text-sm text-muted-foreground mb-2">{productData.brand}</p>
              <h1 className="text-3xl font-heading font-bold text-balance mb-4">{productData.name}</h1>

              {/* Rating */}
              <div className="flex items-center gap-2 mb-4">
                <div className="flex items-center">
                  {[...Array(5)].map((_, i) => (
                    <Star
                      key={i}
                      className={`h-4 w-4 ${
                        i < Math.floor(productData.rating) ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"
                      }`}
                    />
                  ))}
                </div>
                <span className="text-sm font-medium">{productData.rating}</span>
                <span className="text-sm text-muted-foreground">({productData.reviewCount} reviews)</span>
              </div>
            </div>

            {/* Price */}
            <div className="flex items-center gap-3">
              <span className="text-3xl font-bold text-foreground">${productData.price}</span>
              <span className="text-lg text-muted-foreground line-through">${productData.originalPrice}</span>
              <Badge className="bg-destructive text-destructive-foreground">-{discount}%</Badge>
            </div>

            {/* Stock Status */}
            <div className="flex items-center gap-2">
              <div className={`h-2 w-2 rounded-full ${productData.inStock ? "bg-green-500" : "bg-red-500"}`} />
              <span className={`text-sm font-medium ${productData.inStock ? "text-green-600" : "text-red-600"}`}>
                {productData.inStock ? `In Stock (${productData.stockCount} available)` : "Out of Stock"}
              </span>
            </div>

            {/* Description */}
            <p className="text-muted-foreground leading-relaxed">{productData.description}</p>

            {/* Color Selection */}
            <div>
              <h3 className="font-semibold mb-3">Color: {selectedColor}</h3>
              <div className="flex gap-2">
                {productData.variants.color.map((color) => (
                  <button
                    key={color}
                    onClick={() => setSelectedColor(color)}
                    className={`px-4 py-2 border rounded-md text-sm font-medium transition-colors ${
                      selectedColor === color
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:border-primary"
                    }`}
                  >
                    {color}
                  </button>
                ))}
              </div>
            </div>

            {/* Quantity and Add to Cart */}
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold mb-3">Quantity</h3>
                <div className="flex items-center gap-3">
                  <div className="flex items-center border rounded-md">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setQuantity(Math.max(1, quantity - 1))}
                      disabled={quantity <= 1}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <span className="px-4 py-2 text-center min-w-[60px]">{quantity}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setQuantity(Math.min(productData.stockCount, quantity + 1))}
                      disabled={quantity >= productData.stockCount}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  <span className="text-sm text-muted-foreground">Max {productData.stockCount} per order</span>
                </div>
              </div>

              <div className="flex gap-3">
                <Button size="lg" className="flex-1" disabled={!productData.inStock}>
                  Add to Cart - ${(productData.price * quantity).toFixed(2)}
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => setIsWishlisted(!isWishlisted)}
                  className={isWishlisted ? "text-destructive border-destructive" : ""}
                >
                  <Heart className={`h-5 w-5 ${isWishlisted ? "fill-current" : ""}`} />
                </Button>
                <Button variant="outline" size="lg">
                  <Share2 className="h-5 w-5" />
                </Button>
              </div>
            </div>

            {/* Trust Signals */}
            <Card>
              <CardContent className="p-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="flex items-center gap-2">
                    <Truck className="h-4 w-4 text-primary" />
                    <div>
                      <p className="text-sm font-medium">Free Shipping</p>
                      <p className="text-xs text-muted-foreground">On orders over $50</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-primary" />
                    <div>
                      <p className="text-sm font-medium">2 Year Warranty</p>
                      <p className="text-xs text-muted-foreground">Full coverage</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <RotateCcw className="h-4 w-4 text-primary" />
                    <div>
                      <p className="text-sm font-medium">30-Day Returns</p>
                      <p className="text-xs text-muted-foreground">Easy returns</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Product Features */}
        <div className="mb-16">
          <h2 className="text-2xl font-heading font-bold mb-6">Key Features</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {productData.features.map((feature, index) => (
              <div key={index} className="flex items-center gap-3 p-4 bg-muted/30 rounded-lg">
                <div className="h-2 w-2 bg-primary rounded-full flex-shrink-0" />
                <span className="text-sm">{feature}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Product Specifications */}
        <div className="mb-16">
          <ProductSpecs />
        </div>

        {/* Reviews Section */}
        <div className="mb-16">
          <ProductReviews
            productId={productData.id}
            rating={productData.rating}
            reviewCount={productData.reviewCount}
          />
        </div>

        {/* Related Products */}
        <div>
          <RelatedProducts currentProductId={productData.id} category={productData.category} />
        </div>
      </main>

      <Footer />
    </div>
  )
}
