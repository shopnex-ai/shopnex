import { Button } from "@/components/ui/button"
import { Facebook, Twitter, Instagram, Youtube, Linkedin } from "lucide-react"

export function SocialLinks() {
  const socialLinks = [
    { name: "Facebook", icon: Facebook, href: "https://facebook.com/shopnex" },
    { name: "Twitter", icon: Twitter, href: "https://twitter.com/shopnex" },
    { name: "Instagram", icon: Instagram, href: "https://instagram.com/shopnex" },
    { name: "YouTube", icon: Youtube, href: "https://youtube.com/shopnex" },
    { name: "LinkedIn", icon: Linkedin, href: "https://linkedin.com/company/shopnex" },
  ]

  return (
    <div className="flex items-center gap-2">
      {socialLinks.map((social) => {
        const Icon = social.icon
        return (
          <Button key={social.name} variant="ghost" size="sm" asChild className="hover:text-primary">
            <a href={social.href} target="_blank" rel="noopener noreferrer" aria-label={`Follow us on ${social.name}`}>
              <Icon className="h-4 w-4" />
            </a>
          </Button>
        )
      })}
    </div>
  )
}
