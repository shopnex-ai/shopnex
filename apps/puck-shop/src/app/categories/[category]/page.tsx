import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { ProductCard } from "@/components/product-card"
import { ProductFilters } from "@/components/product-filters"
import { ProductSort } from "@/components/product-sort"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Filter, Grid, List } from "lucide-react"
import { Suspense } from "react"

// Sample product data for category
const categoryProducts = [
  {
    id: "1",
    name: "Wireless Bluetooth Headphones with Noise Cancellation",
    price: 89.99,
    originalPrice: 129.99,
    rating: 4.5,
    reviewCount: 1247,
    image: "/wireless-bluetooth-headphones.png",
    badge: "Best Seller",
    brand: "AudioTech",
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
    brand: "FitPro",
  },
  {
    id: "3",
    name: "Smartphone with 128GB Storage",
    price: 599.99,
    rating: 4.6,
    reviewCount: 2341,
    image: "/placeholder.svg?key=phone1",
    brand: "TechCorp",
  },
  {
    id: "4",
    name: "Laptop Computer 15-inch Display",
    price: 899.99,
    originalPrice: 1099.99,
    rating: 4.4,
    reviewCount: 567,
    image: "/placeholder.svg?key=laptop1",
    brand: "CompuMax",
  },
  {
    id: "5",
    name: "Wireless Gaming Mouse",
    price: 49.99,
    rating: 4.7,
    reviewCount: 834,
    image: "/placeholder.svg?key=mouse1",
    brand: "GameGear",
  },
  {
    id: "6",
    name: "Bluetooth Speaker Portable",
    price: 79.99,
    originalPrice: 99.99,
    rating: 4.2,
    reviewCount: 445,
    image: "/placeholder.svg?key=speaker1",
    brand: "SoundWave",
  },
]

interface CategoryPageProps {
  params: {
    category: string
  }
  searchParams: {
    sort?: string
    view?: string
    page?: string
  }
}

export default function CategoryPage({ params, searchParams }: CategoryPageProps) {
  const category = decodeURIComponent(params.category)
  const currentView = searchParams.view || "grid"
  const currentPage = Number.parseInt(searchParams.page || "1")
  const itemsPerPage = 12
  const totalItems = categoryProducts.length
  const totalPages = Math.ceil(totalItems / itemsPerPage)

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
              <BreadcrumbPage className="capitalize">{category}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Category Header */}
        <div className="mb-8">
          <h1 className="text-3xl md:text-4xl font-heading font-bold mb-4 capitalize">{category}</h1>
          <p className="text-muted-foreground text-lg">
            Discover our wide selection of {category.toLowerCase()} products
          </p>
        </div>

        <div className="flex flex-col lg:flex-row gap-8">
          {/* Filters Sidebar */}
          <aside className="lg:w-64 flex-shrink-0">
            <div className="sticky top-24">
              <div className="flex items-center gap-2 mb-4 lg:hidden">
                <Button variant="outline" size="sm">
                  <Filter className="h-4 w-4 mr-2" />
                  Filters
                </Button>
              </div>
              <div className="hidden lg:block">
                <Suspense fallback={<div>Loading filters...</div>}>
                  <ProductFilters />
                </Suspense>
              </div>
            </div>
          </aside>

          {/* Main Content */}
          <div className="flex-1">
            {/* Results Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
              <div className="flex items-center gap-4">
                <p className="text-muted-foreground">
                  Showing {(currentPage - 1) * itemsPerPage + 1}-{Math.min(currentPage * itemsPerPage, totalItems)} of{" "}
                  {totalItems} results
                </p>
                <Badge variant="secondary">{category}</Badge>
              </div>

              <div className="flex items-center gap-2">
                <ProductSort />

                <div className="flex items-center border rounded-md">
                  <Button variant={currentView === "grid" ? "default" : "ghost"} size="sm" className="rounded-r-none">
                    <Grid className="h-4 w-4" />
                  </Button>
                  <Button variant={currentView === "list" ? "default" : "ghost"} size="sm" className="rounded-l-none">
                    <List className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Products Grid */}
            <div
              className={`grid gap-6 mb-8 ${
                currentView === "grid" ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "grid-cols-1"
              }`}
            >
              {categoryProducts.map((product) => (
                <ProductCard key={product.id} {...product} />
              ))}
            </div>

            {/* Pagination */}
            <div className="flex justify-center items-center gap-2">
              <Button variant="outline" disabled={currentPage === 1} className="px-3 bg-transparent">
                Previous
              </Button>

              {[...Array(totalPages)].map((_, i) => (
                <Button key={i + 1} variant={currentPage === i + 1 ? "default" : "outline"} size="sm" className="w-10">
                  {i + 1}
                </Button>
              ))}

              <Button variant="outline" disabled={currentPage === totalPages} className="px-3 bg-transparent">
                Next
              </Button>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
