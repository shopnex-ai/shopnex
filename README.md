![shopnex](https://github.com/user-attachments/assets/d14a5926-dc54-486b-92c9-8bdc7133abb7)

<br/>
<br/>

![License](https://img.shields.io/github/license/shopnex-ai/shopnex)
![Build](https://img.shields.io/github/actions/workflow/status/shopnex-ai/shopnex/ci.yaml)
![Contributions](https://img.shields.io/badge/contributions-welcome-brightgreen)
![Last Commit](https://img.shields.io/github/last-commit/shopnex-ai/shopnex)
<a href="https://discord.gg/6NTt49jguY">
<img src="https://img.shields.io/badge/chat-on%20discord-7289DA.svg" alt="Discord Chat" />
</a>

# ShopNex – The Open Source eCommerce Built on Payload CMS

**ShopNex** is a modern eCommerce template powered by **Payload CMS**, designed to help you launch a fully functional online store with ease. Whether you're starting a new store or building a scalable commerce platform, ShopNex provides a robust set of features and tools to streamline your development process.

Here’s a cleaner and more polished version of your **Getting Started** section with better formatting, a clearer explanation of the CLI command, and flag descriptions:

---

## 🚀 Getting Started

Spin up a new **ShopNex** project in seconds using our CLI tool:

### 1. Create a New Project

Run one of the following commands:

```bash
pnpm dlx create-shopnex-app
# or
npx create-shopnex-app
```

This command will guide you through the setup process, prompting you for options like your preferred database and environment configuration.

---

### 2. Choose Your Storefront

ShopNex offers two options for your storefront:

#### Builder.io Visual Builder

If you choose Builder.io as your storefront:

1. Configure your `.env` file with Builder.io credentials
2. Run `pnpm run pages:seed` to seed your Builder.io pages

### 3. Optional CLI Flags

You can customize the setup behavior using the following flags:

| Flag         | Description                                                                |
| ------------ | -------------------------------------------------------------------------- |
| `--fresh`    | Skips seeding of initial data. Starts a clean setup.                       |
| `--skip-env` | Skips environment variable setup. You can configure `.env` manually later. |
| `--skip-dev` | Does not automatically start the development server after setup.           |

Example usage:

```bash
pnpm dlx create-shopnex-app my-store --fresh --skip-env
```

## 📁 Project Structure

```text
├── src
│   ├── access              # Role-based access logic
│   ├── admin               # Custom admin panel components
│   ├── app                 # Core app logic: frontend, API routes, Payload admin
│   ├── collections         # Payload CMS collections
│   │   ├── GiftCards.ts         # Gift cards collection
│   │   ├── Locations.ts         # Locations collection
│   │   ├── Users.ts             # Users collection
│   │   ├── Products             # Example of modular collection structure
│   │   │   ├── Products.ts      # Main collection config for products
│   │   │   └── fields           # Subfolder for custom fields (e.g., price, inventory)
│   │   ├── ...                  # Other collections
│   │   └── Policies.ts          # Example of custom collection with custom fields
│   ├── fields              # Reusable field definitions (e.g., slug, description)
│   ├── globals             # Global site settings (Footer, Store config, etc.)
│   ├── seed                # JSON and script-based seeding logic
│   ├── utils               # Common utilities (formatting, mapping, etc.)
│   └── webhooks            # Webhooks for external event handling (e.g., payments)
└── tsconfig.json
```

## ✨ Features

- 📊 Analytics Dashboard - Track performance with a sales chart

- 🛍️ Beautiful Storefront - Built using Next.js & Tailwind CSS

- 💳 Stripe Checkout Integration - Seamless and secure payment experience

- 📦 CJ Dropshipping Integration - Effortless product sourcing and fulfillment

- 📁 Customer & Order Management - Manage customers, orders, and store operations easily

- 🎨 Custom Branding & UI Customization - Make the store truly yours with flexible design options

- 🧩 Plugin Marketplace - Integrate third-party tools with just a few clicks

- 🗂️ Import Mapping – Easily import collection data from various systems via CSV or Excel

## 🛠️ Contributing

> 💡 Pro tip: Don’t forget to ⭐ star the repo and **fork** it to make it your own!

We welcome contributions! If you find any bugs or have ideas for improvements, feel free to:

- 🐛 [Open an issue](https://github.com/your-repo/issues) to report bugs or request features.
- 🔧 Fork the repo and submit a pull request with your improvements.
- 💬 Join our [Discord](https://discord.gg/MFc9x7vdXK) community for discussions and support.

Before contributing, please:

- Check existing issues and PRs to avoid duplication.
- Follow any project-specific contribution guidelines (if available).

## 📄 License

Shopnex is licensed under the MIT License.
