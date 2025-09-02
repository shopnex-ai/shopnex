"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { User, Package, Heart, MapPin, CreditCard, Settings, LogOut, Home } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

const navigationItems = [
  {
    href: "/account",
    label: "Dashboard",
    icon: Home,
  },
  {
    href: "/account/orders",
    label: "Orders",
    icon: Package,
  },
  {
    href: "/account/wishlist",
    label: "Wishlist",
    icon: Heart,
  },
  {
    href: "/account/addresses",
    label: "Addresses",
    icon: MapPin,
  },
  {
    href: "/account/payment",
    label: "Payment Methods",
    icon: CreditCard,
  },
  {
    href: "/account/profile",
    label: "Profile Settings",
    icon: User,
  },
  {
    href: "/account/settings",
    label: "Account Settings",
    icon: Settings,
  },
]

export function AccountNavigation() {
  const pathname = usePathname()

  return (
    <div className="space-y-4">
      {/* User Profile Card */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <Avatar className="h-12 w-12">
              <AvatarImage src="/placeholder.svg?key=avatar" alt="John Doe" />
              <AvatarFallback>JD</AvatarFallback>
            </Avatar>
            <div>
              <CardTitle className="text-base">John Doe</CardTitle>
              <p className="text-sm text-muted-foreground">john.doe@email.com</p>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Navigation Menu */}
      <Card>
        <CardContent className="p-2">
          <nav className="space-y-1">
            {navigationItems.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.href

              return (
                <Button
                  key={item.href}
                  asChild
                  variant={isActive ? "secondary" : "ghost"}
                  className={cn(
                    "w-full justify-start gap-3 h-10",
                    isActive && "bg-primary/10 text-primary hover:bg-primary/10",
                  )}
                >
                  <Link href={item.href}>
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                </Button>
              )
            })}

            <div className="pt-2 border-t">
              <Button
                variant="ghost"
                className="w-full justify-start gap-3 h-10 text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </Button>
            </div>
          </nav>
        </CardContent>
      </Card>
    </div>
  )
}
