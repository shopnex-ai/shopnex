# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Puck Editor Plugin (`@shopnex/puck-editor-plugin`) - a Payload CMS plugin that integrates the Puck visual page editor for building e-commerce storefronts. The plugin provides a collection of pre-built blocks and components specifically designed for ShopNex e-commerce sites.

## Build Commands

- `pnpm clean` - Remove build artifacts and cache
- `pnpm build:swc` - Transpile TypeScript using SWC
- `pnpm build:types` - Generate TypeScript declaration files
- `pnpm copyfiles` - Copy static assets to dist
- `pnpm turbo build` - Full build using turbo (from root)
- `pnpm lint` - Run ESLint
- `pnpm lint:fix` - Run ESLint with auto-fix
- `pnpm prepublishOnly` - Clean and build before publishing

## Architecture

### Core Structure
- **Plugin Entry**: `src/index.ts` - Main plugin function that registers the PuckPages collection
- **Payload Collection**: `src/collections/PuckPages.ts` - Defines the "puck-pages" collection with JSON field for Puck editor
- **Client Config**: `src/config/client-config.ts` - Centralized configuration for all Puck components and categories
- **Exports**: Separate entry points for RSC (`/rsc`) and client (`/client`) usage

### Component Categories
The plugin organizes components into logical categories:
- **Navigation**: TopHeader, NavBar, Footer, Breadcrumb
- **Heroes**: Hero1-5 variants
- **E-commerce**: ProductsGrid1, ProductDetails  
- **Layout**: Grid, Flex, Space
- **Typography**: Heading, Text
- **Interactive**: Button
- **Other**: Card, Logos, Stats

### Block Architecture
Each block in `src/config/blocks/` follows a consistent pattern:
- `index.tsx` - Component definition with props interface and Puck configuration
- Organized by category (Navigation, Heroes, E-commerce, etc.)
- Uses className factory utilities for consistent styling

### Export Strategy
- Development: Direct TypeScript imports from `/src`
- Production: Compiled JavaScript from `/dist` 
- Supports both RSC and client-side usage patterns

## Technical Details

- **Build Tool**: SWC for fast TypeScript compilation
- **Target**: ESNext with ES6 modules
- **React**: Automatic runtime, TSX support
- **Dependencies**: Uses @measured/puck, @shopnex/types, recharts for charts
- **Plugin System**: Integrates with ShopNex plugin sync mechanism for metadata