import type { Plugin } from "payload";

import { builderIoPlugin } from "@shopnex/builder-io-plugin";
import { cjPlugin } from "@shopnex/cj-plugin";
import { importExportPlugin } from "@shopnex/import-export-plugin";
import { storePlugin } from "@shopnex/store-plugin";
import { stripePlugin } from "@shopnex/stripe-plugin";

import { paymentCanceled } from "./webhooks/payment-canceled";
import { paymentSucceeded } from "./webhooks/payment-succeeded";

export const plugins: Plugin[] = [
    storePlugin({}),
    cjPlugin({
        cjApiKey: process.env.CJ_PASSWORD || "",
        cjEmailAddress: process.env.CJ_EMAIL_ADDRESS || "",
        cjRefreshToken: process.env.CJ_REFRESH_TOKEN,
    }),
    stripePlugin({
        isTestKey: Boolean(process.env.NEXT_PUBLIC_STRIPE_IS_TEST_KEY),
        logs: true,
        paymentCollectionSlug: "payments",
        rest: false,
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
        privateKey: process.env.BUILDER_IO_PRIVATE_KEY,
        publicKey: process.env.NEXT_PUBLIC_BUILDER_IO_PUBLIC_KEY,
    }),
];
