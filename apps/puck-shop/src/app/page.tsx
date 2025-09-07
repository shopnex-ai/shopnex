import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { ProductCard } from "@/components/product-card";
import { FlashDeals } from "@/components/flash-deals";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Truck, Shield, Headphones, RotateCcw } from "lucide-react";
import {
    getFeaturedProducts,
    getCollections,
    getFlashDeals,
    getPromotionalBanners,
} from "@/lib/payload-sdk";

// Sample product data
const featuredProducts = [
    {
        id: "1",
        name: "Wireless Bluetooth Headphones with Noise Cancellation",
        price: 89.99,
        originalPrice: 129.99,
        rating: 4.5,
        reviewCount: 1247,
        image: "/wireless-bluetooth-headphones.png",
        badge: "Best Seller",
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
];

const categories = [
    {
        name: "Electronics",
        image: "/electronics-category.png",
        itemCount: "2,500+ items",
    },
    {
        name: "Fashion",
        image: "/fashion-category.png",
        itemCount: "5,200+ items",
    },
    {
        name: "Home & Garden",
        image: "/home-garden-category.png",
        itemCount: "3,800+ items",
    },
    {
        name: "Sports",
        image: "/sports-collage.png",
        itemCount: "1,900+ items",
    },
];

export default async function HomePage() {
    const [
        featuredProductsData,
        collectionsData = [],
        flashDealsData = [],
        promotionalBannersData = [],
    ] = await Promise.all([
        getFeaturedProducts(),
        getCollections(),
        getFlashDeals(),
        getPromotionalBanners(),
    ]);

    const formattedProducts = featuredProductsData.map((product: any) => ({
        id: product.id,
        name: product.title,
        price: product.variants?.[0]?.price || 0,
        originalPrice: product.variants?.[0]?.originalPrice,
        rating: 4.5, // Default rating since it's not in CMS
        reviewCount: Math.floor(Math.random() * 1000) + 100, // Mock review count
        image: product.variants?.[0]?.gallery?.[0]?.url || "/placeholder.svg",
        badge: product.featured ? "Featured" : undefined,
    }));

    const formattedCategories = collectionsData
        .slice(0, 4)
        .map((collection: any) => ({
            name: collection.title,
            image:
                collection.image?.url ||
                collection.imageUrl ||
                "/placeholder.svg",
            itemCount: `${collection.products?.length || 0} items`,
        }));

    return (
        <div className="min-h-screen bg-background">
            <Header />

            <main>
                {/* Hero Section */}
                <section className="relative bg-gradient-to-r from-primary/10 to-secondary/10 py-16 md:py-24">
                    <div className="container mx-auto px-4">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                            <div>
                                <Badge className="mb-4 bg-primary/10 text-primary border-primary/20">
                                    New Collection Available
                                </Badge>
                                <h1 className="text-4xl md:text-6xl font-heading font-bold text-balance mb-6">
                                    Discover Amazing Products at{" "}
                                    <span className="text-primary">
                                        ShopNex
                                    </span>
                                </h1>
                                <p className="text-lg text-muted-foreground mb-8 text-pretty">
                                    Your trusted destination for quality
                                    products, competitive prices, and
                                    exceptional service. Shop with confidence
                                    and discover what makes us different.
                                </p>
                                <div className="flex flex-col sm:flex-row gap-4">
                                    <Button size="lg" className="px-8">
                                        Shop Now
                                        <ArrowRight className="ml-2 h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="lg"
                                        className="px-8 bg-transparent"
                                    >
                                        View Categories
                                    </Button>
                                </div>
                            </div>
                            <div className="relative">
                                <img
                                    src="/modern-ecommerce-hero-shopping.png"
                                    alt="ShopNex Hero"
                                    className="w-full h-auto rounded-lg shadow-2xl"
                                />
                            </div>
                        </div>
                    </div>
                </section>

                {/* Flash Deals */}
                <FlashDeals deals={flashDealsData} />

                {/* Trust Signals */}
                <section className="py-12 bg-muted/30">
                    <div className="container mx-auto px-4">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                            <div className="flex items-center gap-3">
                                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                                    <Truck className="h-6 w-6 text-primary" />
                                </div>
                                <div>
                                    <h3 className="font-semibold">
                                        Free Shipping
                                    </h3>
                                    <p className="text-sm text-muted-foreground">
                                        On orders over $50
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                                    <Shield className="h-6 w-6 text-primary" />
                                </div>
                                <div>
                                    <h3 className="font-semibold">
                                        Secure Payment
                                    </h3>
                                    <p className="text-sm text-muted-foreground">
                                        100% protected
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                                    <Headphones className="h-6 w-6 text-primary" />
                                </div>
                                <div>
                                    <h3 className="font-semibold">
                                        24/7 Support
                                    </h3>
                                    <p className="text-sm text-muted-foreground">
                                        Always here to help
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                                    <RotateCcw className="h-6 w-6 text-primary" />
                                </div>
                                <div>
                                    <h3 className="font-semibold">
                                        Easy Returns
                                    </h3>
                                    <p className="text-sm text-muted-foreground">
                                        30-day guarantee
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Featured Categories */}
                <section className="py-16">
                    <div className="container mx-auto px-4">
                        <div className="text-center mb-12">
                            <h2 className="text-3xl md:text-4xl font-heading font-bold mb-4">
                                Shop by Category
                            </h2>
                            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                                Explore our wide range of categories and find
                                exactly what you&apos;re looking for
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                            {(formattedCategories.length > 0
                                ? formattedCategories
                                : categories
                            ).map((category) => (
                                <Card
                                    key={category.name}
                                    className="group cursor-pointer overflow-hidden hover:shadow-lg transition-all duration-300"
                                >
                                    <div className="relative aspect-[4/3] overflow-hidden">
                                        <img
                                            src={
                                                category.image ||
                                                "/placeholder.svg"
                                            }
                                            alt={category.name}
                                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                                        />
                                        <div className="absolute inset-0 bg-black/20 group-hover:bg-black/30 transition-colors" />
                                        <div className="absolute bottom-4 left-4 text-white">
                                            <h3 className="text-xl font-heading font-semibold mb-1">
                                                {category.name}
                                            </h3>
                                            <p className="text-sm opacity-90">
                                                {category.itemCount}
                                            </p>
                                        </div>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    </div>
                </section>

                {/* Featured Products */}
                <section className="py-16 bg-muted/30">
                    <div className="container mx-auto px-4">
                        <div className="flex items-center justify-between mb-12">
                            <div>
                                <h2 className="text-3xl md:text-4xl font-heading font-bold mb-4">
                                    Featured Products
                                </h2>
                                <p className="text-lg text-muted-foreground">
                                    Discover our most popular and trending items
                                </p>
                            </div>
                            <Button
                                variant="outline"
                                className="hidden md:flex bg-transparent"
                            >
                                View All Products
                                <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                            {(formattedProducts.length > 0
                                ? formattedProducts
                                : featuredProducts
                            ).map((product) => (
                                <ProductCard key={product.id} {...product} />
                            ))}
                        </div>

                        <div className="text-center mt-8 md:hidden">
                            <Button variant="outline">
                                View All Products
                                <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </section>

                {/* Promotional Banner */}
                {promotionalBannersData.length > 0 && (
                    <section className="py-16">
                        <div className="container mx-auto px-4">
                            {promotionalBannersData
                                .slice(0, 1)
                                .map((banner) => {
                                    const gradientClass =
                                        {
                                            "primary-secondary":
                                                "from-primary to-secondary",
                                            "red-orange":
                                                "from-red-500 to-orange-500",
                                            "blue-purple":
                                                "from-blue-500 to-purple-500",
                                            "green-teal":
                                                "from-green-500 to-teal-500",
                                        }[banner.backgroundGradient] ||
                                        "from-primary to-secondary";

                                    return (
                                        <Card
                                            key={banner.id}
                                            className={`relative overflow-hidden bg-gradient-to-r ${gradientClass} text-primary-foreground`}
                                        >
                                            <CardContent className="p-8 md:p-12">
                                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
                                                    <div>
                                                        <h2 className="text-3xl md:text-4xl font-heading font-bold mb-4">
                                                            {banner.title}
                                                        </h2>
                                                        {banner.subtitle && (
                                                            <h3 className="text-xl mb-2 opacity-90">
                                                                {
                                                                    banner.subtitle
                                                                }
                                                            </h3>
                                                        )}
                                                        <p className="text-lg mb-6 opacity-90">
                                                            {banner.description}
                                                        </p>
                                                        {banner.buttonText &&
                                                            banner.buttonUrl && (
                                                                <Button
                                                                    size="lg"
                                                                    variant="secondary"
                                                                    className="px-8"
                                                                    asChild
                                                                >
                                                                    <a
                                                                        href={
                                                                            banner.buttonUrl
                                                                        }
                                                                    >
                                                                        {
                                                                            banner.buttonText
                                                                        }
                                                                        <ArrowRight className="ml-2 h-4 w-4" />
                                                                    </a>
                                                                </Button>
                                                            )}
                                                    </div>
                                                    <div className="relative">
                                                        <img
                                                            src={
                                                                banner.image
                                                                    ?.url ||
                                                                "/special-offer-sale-banner.png"
                                                            }
                                                            alt={banner.title}
                                                            className="w-full h-auto rounded-lg"
                                                        />
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    );
                                })}
                        </div>
                    </section>
                )}
            </main>

            <Footer />
        </div>
    );
}
