"use client"

import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { AccountNavigation } from "@/components/account-navigation"
import { ProductCard } from "@/components/product-card"
import { Button } from "@/components/ui/button"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Heart, ShoppingCart } from "lucide-react"

// Sample wishlist data
const wishlistItems = [
  {
    id: "1",
    name: "Wireless Bluetooth Headphones with Active Noise Cancellation",
    price: 89.99,
    originalPrice: 129.99,
    rating: 4.5,
    reviewCount: 1247,
    image: "/wireless-bluetooth-headphones.png",
    badge: "Best Seller",
    isWishlisted: true,
  },
  {
    id: "2",
    name: "Smart Fitness Watch with Heart Rate Monitor",
    price: 199.99,
    originalPrice: 249.99,
    rating: 4.3,
    reviewCount: 892,
    image: "/smart-fitness-watch.png",
    badge: "New",
    isWishlisted: true,
  },
  {
    id: "3",
    name: "Premium Coffee Maker with Grinder",
    price: 159.99,
    rating: 4.7,
    reviewCount: 634,
    image: "/premium-coffee-maker.png",
    isWishlisted: true,
  },
]

export default function WishlistPage() {
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
              <BreadcrumbLink href="/account">My Account</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Wishlist</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Account Navigation */}
          <div className="lg:col-span-1">
            <AccountNavigation />
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3 space-y-6">
            {/* Page Header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-heading font-bold flex items-center gap-3">
                  <Heart className="h-8 w-8 text-primary" />
                  My Wishlist
                </h1>
                <p className="text-muted-foreground">
                  {wishlistItems.length} item{wishlistItems.length !== 1 ? "s" : ""} saved for later
                </p>
              </div>
              {wishlistItems.length > 0 && (
                <Button>
                  <ShoppingCart className="h-4 w-4 mr-2" />
                  Add All to Cart
                </Button>
              )}
            </div>

            {/* Wishlist Items */}
            {wishlistItems.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {wishlistItems.map((item) => (
                  <ProductCard key={item.id} {...item} />
                ))}
              </div>
            ) : (
              <div className="text-center py-16">
                <Heart className="h-24 w-24 text-muted-foreground mx-auto mb-6" />
                <h2 className="text-2xl font-heading font-semibold mb-4">Your wishlist is empty</h2>
                <p className="text-muted-foreground mb-8 max-w-md mx-auto">
                  Save items you love by clicking the heart icon. They'll appear here for easy access later.
                </p>
                <Button size="lg">Start Shopping</Button>
              </div>
            )}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
