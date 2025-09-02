"use client"

import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { AccountNavigation } from "@/components/account-navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import { Package, Heart, MapPin, CreditCard, User, ShoppingBag } from "lucide-react"
import Link from "next/link"

// Sample user data
const userData = {
  name: "John Doe",
  email: "john.doe@email.com",
  memberSince: "January 2023",
  totalOrders: 12,
  totalSpent: 1247.89,
  rewardPoints: 2450,
}

const recentOrders = [
  {
    id: "SN-2024-001234",
    date: "2024-01-15",
    status: "Delivered",
    total: 89.99,
    items: 1,
  },
  {
    id: "SN-2024-001233",
    date: "2024-01-10",
    status: "In Transit",
    total: 199.99,
    items: 2,
  },
  {
    id: "SN-2024-001232",
    date: "2024-01-05",
    status: "Processing",
    total: 159.99,
    items: 1,
  },
]

export default function AccountPage() {
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
              <BreadcrumbPage>My Account</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Account Navigation */}
          <div className="lg:col-span-1">
            <AccountNavigation />
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3 space-y-8">
            {/* Welcome Section */}
            <div>
              <h1 className="text-3xl font-heading font-bold mb-2">Welcome back, {userData.name}!</h1>
              <p className="text-muted-foreground">Manage your account and track your orders</p>
            </div>

            {/* Account Overview */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                      <ShoppingBag className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{userData.totalOrders}</p>
                      <p className="text-sm text-muted-foreground">Total Orders</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-secondary/10">
                      <CreditCard className="h-6 w-6 text-secondary" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">${userData.totalSpent.toFixed(2)}</p>
                      <p className="text-sm text-muted-foreground">Total Spent</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent/10">
                      <Heart className="h-6 w-6 text-accent" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{userData.rewardPoints}</p>
                      <p className="text-sm text-muted-foreground">Reward Points</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Quick Actions */}
            <Card>
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Button asChild variant="outline" className="h-auto p-4 flex-col gap-2 bg-transparent">
                    <Link href="/account/orders">
                      <Package className="h-6 w-6" />
                      <span>View Orders</span>
                    </Link>
                  </Button>

                  <Button asChild variant="outline" className="h-auto p-4 flex-col gap-2 bg-transparent">
                    <Link href="/account/wishlist">
                      <Heart className="h-6 w-6" />
                      <span>Wishlist</span>
                    </Link>
                  </Button>

                  <Button asChild variant="outline" className="h-auto p-4 flex-col gap-2 bg-transparent">
                    <Link href="/account/addresses">
                      <MapPin className="h-6 w-6" />
                      <span>Addresses</span>
                    </Link>
                  </Button>

                  <Button asChild variant="outline" className="h-auto p-4 flex-col gap-2 bg-transparent">
                    <Link href="/account/profile">
                      <User className="h-6 w-6" />
                      <span>Profile</span>
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Recent Orders */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Recent Orders</CardTitle>
                <Button asChild variant="outline" size="sm">
                  <Link href="/account/orders">View All</Link>
                </Button>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {recentOrders.map((order) => (
                    <div key={order.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center gap-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                          <Package className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-medium">Order {order.id}</p>
                          <p className="text-sm text-muted-foreground">
                            {new Date(order.date).toLocaleDateString()} • {order.items} item
                            {order.items > 1 ? "s" : ""}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">${order.total.toFixed(2)}</p>
                        <Badge
                          variant={
                            order.status === "Delivered"
                              ? "default"
                              : order.status === "In Transit"
                                ? "secondary"
                                : "outline"
                          }
                        >
                          {order.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Account Info */}
            <Card>
              <CardHeader>
                <CardTitle>Account Information</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="font-medium mb-2">Personal Details</h4>
                    <div className="space-y-1 text-sm">
                      <p>
                        <span className="text-muted-foreground">Name:</span> {userData.name}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Email:</span> {userData.email}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Member since:</span> {userData.memberSince}
                      </p>
                    </div>
                  </div>
                  <div>
                    <h4 className="font-medium mb-2">Preferences</h4>
                    <div className="space-y-1 text-sm">
                      <p>
                        <span className="text-muted-foreground">Newsletter:</span> Subscribed
                      </p>
                      <p>
                        <span className="text-muted-foreground">SMS Updates:</span> Enabled
                      </p>
                      <p>
                        <span className="text-muted-foreground">Currency:</span> USD
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
