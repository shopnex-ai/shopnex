"use client"

import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { AccountNavigation } from "@/components/account-navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Package, Search, Eye, Download, RotateCcw } from "lucide-react"
import { useState } from "react"

// Sample orders data
const orders = [
  {
    id: "SN-2024-001234",
    date: "2024-01-15",
    status: "Delivered",
    total: 89.99,
    items: [
      {
        name: "Wireless Bluetooth Headphones",
        image: "/wireless-bluetooth-headphones.png",
        quantity: 1,
        price: 89.99,
      },
    ],
    tracking: "1Z999AA1234567890",
    deliveryDate: "2024-01-18",
  },
  {
    id: "SN-2024-001233",
    date: "2024-01-10",
    status: "In Transit",
    total: 399.98,
    items: [
      {
        name: "Smart Fitness Watch",
        image: "/smart-fitness-watch.png",
        quantity: 2,
        price: 199.99,
      },
    ],
    tracking: "1Z999AA1234567891",
    estimatedDelivery: "2024-01-20",
  },
  {
    id: "SN-2024-001232",
    date: "2024-01-05",
    status: "Processing",
    total: 159.99,
    items: [
      {
        name: "Premium Coffee Maker",
        image: "/premium-coffee-maker.png",
        quantity: 1,
        price: 159.99,
      },
    ],
  },
]

export default function OrdersPage() {
  const [searchQuery, setSearchQuery] = useState("")

  const filteredOrders = orders.filter(
    (order) =>
      order.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.items.some((item) => item.name.toLowerCase().includes(searchQuery.toLowerCase())),
  )

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Delivered":
        return "default"
      case "In Transit":
        return "secondary"
      case "Processing":
        return "outline"
      default:
        return "outline"
    }
  }

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
              <BreadcrumbPage>Orders</BreadcrumbPage>
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
                <h1 className="text-3xl font-heading font-bold">My Orders</h1>
                <p className="text-muted-foreground">Track and manage your orders</p>
              </div>
            </div>

            {/* Search */}
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search orders..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Orders List */}
            <div className="space-y-4">
              {filteredOrders.map((order) => (
                <Card key={order.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-lg">Order {order.id}</CardTitle>
                        <p className="text-sm text-muted-foreground">
                          Placed on {new Date(order.date).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-right">
                        <Badge variant={getStatusColor(order.status)}>{order.status}</Badge>
                        <p className="text-lg font-semibold mt-1">${order.total.toFixed(2)}</p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {/* Order Items */}
                    <div className="space-y-3 mb-4">
                      {order.items.map((item, index) => (
                        <div key={index} className="flex items-center gap-4">
                          <img
                            src={item.image || "/placeholder.svg"}
                            alt={item.name}
                            className="h-16 w-16 rounded object-cover border"
                          />
                          <div className="flex-1">
                            <p className="font-medium">{item.name}</p>
                            <p className="text-sm text-muted-foreground">Quantity: {item.quantity}</p>
                          </div>
                          <span className="font-medium">${(item.price * item.quantity).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>

                    {/* Tracking Info */}
                    {order.tracking && (
                      <div className="mb-4 p-3 bg-muted/30 rounded-lg">
                        <p className="text-sm font-medium mb-1">Tracking Information</p>
                        <p className="text-sm text-muted-foreground">Tracking Number: {order.tracking}</p>
                        {order.deliveryDate && (
                          <p className="text-sm text-muted-foreground">
                            Delivered on {new Date(order.deliveryDate).toLocaleDateString()}
                          </p>
                        )}
                        {order.estimatedDelivery && (
                          <p className="text-sm text-muted-foreground">
                            Estimated delivery: {new Date(order.estimatedDelivery).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm">
                        <Eye className="h-4 w-4 mr-2" />
                        View Details
                      </Button>
                      {order.status === "Delivered" && (
                        <>
                          <Button variant="outline" size="sm">
                            <Download className="h-4 w-4 mr-2" />
                            Invoice
                          </Button>
                          <Button variant="outline" size="sm">
                            <RotateCcw className="h-4 w-4 mr-2" />
                            Return
                          </Button>
                        </>
                      )}
                      {order.tracking && (
                        <Button variant="outline" size="sm">
                          <Package className="h-4 w-4 mr-2" />
                          Track Package
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {filteredOrders.length === 0 && (
              <div className="text-center py-12">
                <Package className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-xl font-semibold mb-2">No orders found</h3>
                <p className="text-muted-foreground mb-6">
                  {searchQuery ? "Try adjusting your search terms" : "You haven't placed any orders yet"}
                </p>
                <Button>Start Shopping</Button>
              </div>
            )}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
