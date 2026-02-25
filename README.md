![shopnex](https://github.com/user-attachments/assets/d14a5926-dc54-486b-92c9-8bdc7133abb7)

<br/>
<br/>

![License](https://img.shields.io/github/license/shopnex-ai/shopnex)
![Build](https://img.shields.io/github/actions/workflow/status/shopnex-ai/shopnex/ci.yaml)
![Contributions](https://img.shields.io/badge/contributions-welcome-brightgreen)
![Last Commit](https://img.shields.io/github/last-commit/shopnex-ai/shopnex)
<a href="https://discord.gg/xQ8xKV6MdF">
<img src="https://img.shields.io/badge/chat-on%20discord-7289DA.svg" alt="Discord Chat" />
</a>

# ShopNex – The Open Source eCommerce Built on Payload CMS

**ShopNex** is a modern eCommerce platform powered by **Payload CMS**, designed to help you launch a fully functional online store with minimal setup. Build scalable commerce solutions with our streamlined development experience.

## 🚀 Quick Start

Get your ShopNex store running in under 2 minutes:

```bash
npx create-shopnex-app my-store
cd my-store
pnpm dev
```

That's it! Your store will be running at:

- **CMS Admin**: http://localhost:3000/admin
- **Storefront**: http://localhost:3000

### Alternative Package Managers

```bash
# Using pnpm (recommended)
pnpm dlx create-shopnex-app my-store

# Using yarn
yarn create shopnex-app my-store

# Using npx
npx create-shopnex-app my-store
```

## ✨ Core Features

### 🛒 Complete E-commerce

- **Product Management** - Variants, pricing, inventory tracking
- **Order Processing** - Cart, checkout, order management
- **Collections & Categories** - Organize your product catalog
- **Gift Cards** - Digital gift card system

### 💳 Payments & Shipping

- **Stripe Integration** - Secure payment processing
- **Multiple Payment Methods** - Cards, digital wallets
- **Shipping Management** - Rates, locations, tracking
- **Tax Calculation** - Automated tax handling

### 📊 Business Intelligence

- **Analytics Dashboard** - Sales tracking with charts
- **Store Settings** - Currency, policies, branding
- **Import/Export** - Bulk data management via CSV
- **Rate Limiting** - API protection and security

### 🎨 Customization

- **Rich Text Editor** - Tiptap-powered content editing
- **Media Management** - Optimized image handling
- **Theme System** - Customizable store appearance
- **Plugin Architecture** - Extensible functionality

### 🚀 Developer Experience

- **TypeScript** - Full type safety
- **Next.js 15** - Latest React features
- **SQLite/Database** - Flexible data storage
- **Testing Suite** - E2E and integration tests

## 📁 Project Structure

```text
my-store/
├── src/
│   ├── app/
│   │   ├── (payload)/        # Payload CMS admin & API
│   │   └── (storefront)/     # Next.js storefront
│   ├── collections/          # Data models
│   │   ├── Products/
│   │   ├── Orders/
│   │   ├── Collections/
│   │   └── Users/
│   ├── fields/              # Reusable field types
│   └── utils/               # Helper functions
├── payload.config.ts        # Payload CMS configuration
└── package.json
```

## 🗺️ Roadmap

✅ Done · 🔄 In Progress · 📋 Planned · 🔍 Investigating

| 🛒 Core | 🔌 Plugins | 🎨 Storefronts | 📚 Docs |
|---|---|---|---|
| ✅ Product Management | ✅ Stripe Payment | ✅ Custom Storefront | 📋 Self-Hosting |
| ✅ Inventory Management | ✅ CJ Dropshipping | ✅ Builder.io | 📋 Plugin Development |
| 🔄 Checkout Flow | 📋 Shippo Fulfillment | ✅ Puck Editor | 📋 Storefront Integration |
| 🔄 Cart Management | 📋 PayPal Payment | 📋 Plasmic | 📋 Authentication |
| 📋 Order History / Tracking | 📋 Mollie Payment | 🔍 Mobile (React Native) | 📋 Multi-Tenancy Guide |
| 📋 Omni-Channel | 📋 Shopify Source | 🔍 POS Integration | |
| 📋 Shipping Management | 📋 Brightpearl | 🔍 Marketplaces | |

## 🛠️ Contributing

> 💡 Pro tip: Don't forget to ⭐ star the repo and **fork** it to make it your own!

We welcome contributions! If you find any bugs or have ideas for improvements, feel free to:

- 🐛 [Open an issue](https://github.com/shopnex-ai/shopnex/issues) to report bugs or request features.
- 🔧 Fork the repo and submit a pull request with your improvements.
- 💬 Join our [Discord](https://discord.gg/xQ8xKV6MdF) community for discussions and support.

Before contributing, please:

- Check existing issues and PRs to avoid duplication.
- Follow any project-specific contribution guidelines (if available).

## 📄 License

Shopnex is licensed under the MIT License.
