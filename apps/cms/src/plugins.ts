import type { Plugin } from "payload";

import { cjPlugin } from "@shopnex/cj-plugin";
import { importExportPlugin } from "@shopnex/import-export-plugin";
import { stripePlugin } from "@shopnex/stripe-plugin";
import { builderIoPlugin } from "@shopnex/builder-io-plugin";

import { adminPluginAccess, admins } from "./access/roles";
import { paymentCanceled, paymentSucceeded } from "./webhooks";
import { quickActionsPlugin } from "@shopnex/quick-actions-plugin";
import { easyEmailPlugin } from "@shopnex/easy-email-plugin";
import { seoPlugin } from "@payloadcms/plugin-seo";
import { analyticsPlugin } from "@shopnex/analytics-plugin";
import { sidebarPlugin } from "@shopnex/sidebar-plugin";

export const plugins: Plugin[] = [
    cjPlugin({
        cjApiKey: process.env.CJ_PASSWORD || "",
        cjEmailAddress: process.env.CJ_EMAIL_ADDRESS || "",
        cjRefreshToken: process.env.CJ_REFRESH_TOKEN,
    }),
    stripePlugin({
        isTestKey: Boolean(process.env.NEXT_PUBLIC_STRIPE_IS_TEST_KEY),
        logs: true,
        paymentCollectionSlug: "payments",
        secretAccess: {
            create: admins,
            read: admins,
            update: admins,
        },
        stripeSecretKey: process.env.STRIPE_SECRET_KEY || "",
        stripeWebhooksEndpointSecret:
            process.env.STRIPE_WEBHOOKS_SIGNING_SECRET,
        webhooks: {
            "payment_intent.canceled": paymentCanceled,
            "payment_intent.succeeded": paymentSucceeded,
        },
    }),
    importExportPlugin({
        collections: ["products", "orders"],
        disableJobsQueue: true,
        importCollections: [
            {
                collectionSlug: "products",
            },
            {
                collectionSlug: "orders",
            },
        ],
    }),
    builderIoPlugin({
        collectionDesignSlug: "themes",
        collectionOverrides: {
            access: {
                create: admins,
                delete: admins,
                read: admins,
                update: admins,
            },
        },
    }),
    easyEmailPlugin({
        collectionOverrides: {
            access: {
                create: adminPluginAccess,
                delete: adminPluginAccess,
                read: adminPluginAccess,
                update: adminPluginAccess,
            },
        },
    }),
    quickActionsPlugin({
        position: "before-nav-links",
    }),
    seoPlugin({
        generateURL: ({ doc }) => {
            return `${process.env.NEXT_PUBLIC_SERVER_URL}/products/${doc.handle}`;
        },
        uploadsCollection: "media",
        generateTitle: ({ doc }) => `ShopNex — ${doc.title}`,
        generateDescription: ({ doc }) => {
            return `some description`;
        },
        fields: ({ defaultFields }) => {
            const resultFields = defaultFields.filter(
                (field) => (field as any).name !== "image"
            );
            return resultFields;
        },
    }),
    analyticsPlugin({}),
    sidebarPlugin(),
];
