import { ProductCard } from "@/components/product-card"

// Sample related products
const relatedProducts = [
  {
    id: "2",
    name: "Smart Fitness Watch with Heart Rate Monitor",
    price: 199.99,
    originalPrice: 249.99,
    rating: 4.3,
    reviewCount: 892,
    image: "/smart-fitness-watch.png",
    badge: "New",
  },
  {
    id: "3",
    name: "Premium Coffee Maker with Grinder",
    price: 159.99,
    rating: 4.7,
    reviewCount: 634,
    image: "/premium-coffee-maker.png",
  },
  {
    id: "4",
    name: "Ergonomic Office Chair with Lumbar Support",
    price: 299.99,
    originalPrice: 399.99,
    rating: 4.6,
    reviewCount: 445,
    image: "/ergonomic-office-chair.png",
  },
  {
    id: "5",
    name: "Wireless Gaming Mouse",
    price: 49.99,
    rating: 4.7,
    reviewCount: 834,
    image: "/placeholder.svg?key=mouse1",
  },
]

interface RelatedProductsProps {
  currentProductId: string
  category: string
}

export function RelatedProducts({ currentProductId, category }: RelatedProductsProps) {
  // Filter out current product
  const filteredProducts = relatedProducts.filter((product) => product.id !== currentProductId)

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-heading font-bold">You Might Also Like</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {filteredProducts.map((product) => (
          <ProductCard key={product.id} {...product} />
        ))}
      </div>
    </div>
  )
}
