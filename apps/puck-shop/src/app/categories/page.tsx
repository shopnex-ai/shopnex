import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

const allCategories = [
  {
    id: "electronics",
    name: "Electronics",
    description: "Smartphones, laptops, headphones, and more",
    image: "/electronics-category.png",
    itemCount: 2847,
    subcategories: ["Smartphones", "Laptops", "Headphones", "Cameras", "Gaming"],
  },
  {
    id: "fashion",
    name: "Fashion",
    description: "Clothing, shoes, accessories for all styles",
    image: "/fashion-category.png",
    itemCount: 5234,
    subcategories: ["Men's Clothing", "Women's Clothing", "Shoes", "Accessories", "Jewelry"],
  },
  {
    id: "home-garden",
    name: "Home & Garden",
    description: "Furniture, decor, tools, and outdoor essentials",
    image: "/home-garden-category.png",
    itemCount: 3891,
    subcategories: ["Furniture", "Home Decor", "Kitchen", "Garden Tools", "Outdoor"],
  },
  {
    id: "sports",
    name: "Sports & Outdoors",
    description: "Fitness equipment, outdoor gear, and sports apparel",
    image: "/sports-collage.png",
    itemCount: 1967,
    subcategories: ["Fitness", "Outdoor Recreation", "Sports Equipment", "Athletic Wear", "Team Sports"],
  },
  {
    id: "books",
    name: "Books & Media",
    description: "Books, movies, music, and digital content",
    image: "/placeholder.svg?key=books1",
    itemCount: 4523,
    subcategories: ["Fiction", "Non-Fiction", "Movies", "Music", "E-books"],
  },
  {
    id: "health",
    name: "Health & Beauty",
    description: "Personal care, cosmetics, and wellness products",
    image: "/placeholder.svg?key=health1",
    itemCount: 2156,
    subcategories: ["Skincare", "Makeup", "Hair Care", "Health Supplements", "Personal Care"],
  },
]

export default function CategoriesPage() {
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
              <BreadcrumbPage>Categories</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Page Header */}
        <div className="text-center mb-12">
          <h1 className="text-3xl md:text-4xl font-heading font-bold mb-4">Shop by Category</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Explore our comprehensive collection of products organized by category. Find exactly what you're looking for
            with ease.
          </p>
        </div>

        {/* Categories Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {allCategories.map((category) => (
            <Card
              key={category.id}
              className="group cursor-pointer overflow-hidden hover:shadow-lg transition-all duration-300"
            >
              <div className="relative aspect-[4/3] overflow-hidden">
                <img
                  src={category.image || "/placeholder.svg"}
                  alt={category.name}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-black/20 group-hover:bg-black/30 transition-colors" />
                <div className="absolute top-4 right-4">
                  <Badge className="bg-background/90 text-foreground">
                    {category.itemCount.toLocaleString()} items
                  </Badge>
                </div>
              </div>

              <CardContent className="p-6">
                <h3 className="text-xl font-heading font-semibold mb-2">{category.name}</h3>
                <p className="text-muted-foreground mb-4">{category.description}</p>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Popular subcategories:</p>
                  <div className="flex flex-wrap gap-1">
                    {category.subcategories.slice(0, 3).map((sub) => (
                      <Badge key={sub} variant="secondary" className="text-xs">
                        {sub}
                      </Badge>
                    ))}
                    {category.subcategories.length > 3 && (
                      <Badge variant="outline" className="text-xs">
                        +{category.subcategories.length - 3} more
                      </Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>

      <Footer />
    </div>
  )
}
