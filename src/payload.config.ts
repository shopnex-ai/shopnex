import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildConfig } from "payload";
import sharp from "sharp";

import { populatePolicies as createDefaultPolicies } from "./app/api/services/policies";
import { Carts } from "./collections/Carts";
import { Collections } from "./collections/Collections";
import { GiftCards } from "./collections/GiftCards";
import { Locations } from "./collections/Locations";
import { Media } from "./collections/Media";
import { Orders } from "./collections/Orders";
import { Payments } from "./collections/Payments";
import { Policies } from "./collections/Policies";
import { Products } from "./collections/Products/Products";
import { Shipping } from "./collections/Shipping";
import { Users } from "./collections/Users";
import { Footer } from "./globals/Footer";
import { HeroSection } from "./globals/HeroSection";
import StoreSettings from "./globals/StoreSettings";
import { plugins } from "./plugins";
import { Pages } from "./collections/Pages";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);
const catalog = [Collections, Products];

export default buildConfig({
    admin: {
        importMap: {
            autoGenerate: false,
            baseDir: path.resolve(dirname),
        },
        suppressHydrationWarning: true,
        user: Users.slug,

        components: {
            Nav: "@/admin/components/Nav/Nav.tsx",
            views: {
                dashboard: {
                    Component: "@/admin/components/Dashboard/Dashboard",
                    path: "@/admin/components/Dashboard/Dashboard",
                },
            },
        },
    },
    collections: [
        Orders,
        ...catalog,
        Users,
        Media,
        Policies,
        GiftCards,
        Pages,
        Payments,
        Locations,
        Shipping,
        Carts,
    ],
    db: sqliteAdapter({
        client: {
            url: process.env.DATABASE_URI || "",
        },
    }),
    editor: lexicalEditor(),
    endpoints: [
        {
            handler: (req) => {
                return Response.json({ status: "OK" });
            },
            method: "get",
            path: "/healthz",
        },
    ],
    globals: [StoreSettings, HeroSection, Footer],
    onInit: async (payload) => {
        await createDefaultPolicies(payload);
    },
    plugins,
    secret: process.env.PAYLOAD_SECRET || "",
    sharp,
    telemetry: false,
    typescript: {
        outputFile: path.resolve(dirname, "payload-types.ts"),
    },
});
