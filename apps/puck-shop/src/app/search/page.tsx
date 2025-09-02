import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { ProductCard } from "@/components/product-card"
import { ProductFilters } from "@/components/product-filters"
import { ProductSort } from "@/components/product-sort"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Search, Filter, Grid, List } from "lucide-react"
import { Suspense } from "react"

// Sample search results
const searchResults = [
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
    name: "Bluetooth Speaker Portable",
    price: 79.99,
    originalPrice: 99.99,
    rating: 4.2,
    reviewCount: 445,
    image: "/placeholder.svg?key=speaker1",
    brand: "SoundWave",
  },
  {
    id: "3",
    name: "Wireless Gaming Mouse",
    price: 49.99,
    rating: 4.7,
    reviewCount: 834,
    image: "/placeholder.svg?key=mouse1",
    brand: "GameGear",
  },
]

interface SearchPageProps {
  searchParams: {
    q?: string
    sort?: string
    view?: string
    page?: string
  }
}

export default function SearchPage({ searchParams }: SearchPageProps) {
  const query = searchParams.q || ""
  const currentView = searchParams.view || "grid"
  const currentPage = Number.parseInt(searchParams.page || "1")
  const itemsPerPage = 12
  const totalItems = searchResults.length
  const totalPages = Math.ceil(totalItems / itemsPerPage)

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto px-4 py-8">
        {/* Search Header */}
        <div className="mb-8">
          <h1 className="text-3xl md:text-4xl font-heading font-bold mb-4">Search Results</h1>

          {/* Search Bar */}
          <div className="relative max-w-2xl mb-4">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search for products, brands, and more..."
              defaultValue={query}
              className="pl-10 pr-4 h-12 bg-muted/50 border-border focus:bg-background"
            />
          </div>

          {query && (
            <p className="text-muted-foreground">
              Search results for: <span className="font-medium text-foreground">"{query}"</span>
            </p>
          )}
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
                <p className="text-muted-foreground">{totalItems} results found</p>
                {query && <Badge variant="secondary">"{query}"</Badge>}
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

            {/* Search Results */}
            {totalItems > 0 ? (
              <>
                <div
                  className={`grid gap-6 mb-8 ${
                    currentView === "grid" ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "grid-cols-1"
                  }`}
                >
                  {searchResults.map((product) => (
                    <ProductCard key={product.id} {...product} />
                  ))}
                </div>

                {/* Pagination */}
                <div className="flex justify-center items-center gap-2">
                  <Button variant="outline" disabled={currentPage === 1} className="px-3 bg-transparent">
                    Previous
                  </Button>

                  {[...Array(totalPages)].map((_, i) => (
                    <Button
                      key={i + 1}
                      variant={currentPage === i + 1 ? "default" : "outline"}
                      size="sm"
                      className="w-10"
                    >
                      {i + 1}
                    </Button>
                  ))}

                  <Button variant="outline" disabled={currentPage === totalPages} className="px-3 bg-transparent">
                    Next
                  </Button>
                </div>
              </>
            ) : (
              <div className="text-center py-12">
                <div className="mb-4">
                  <Search className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-xl font-semibold mb-2">No results found</h3>
                  <p className="text-muted-foreground">Try adjusting your search terms or browse our categories</p>
                </div>
                <Button variant="outline">Browse Categories</Button>
              </div>
            )}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
