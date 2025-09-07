import type { Config } from "@shopnex/types";

import { PayloadSDK } from "@shopnex/payload-sdk";

const isBrowser = typeof window !== "undefined";

export const payloadSdk = new PayloadSDK<Config>({
    baseURL: `${process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3000"}/api`,
    fetch: isBrowser ? (...args) => window.fetch(...args) : undefined,
});

export async function getProducts() {
    try {
        const result = await payloadSdk.find({
            collection: "products",
            limit: 100,
        });
        return result.docs;
    } catch (error) {
        console.error("Error fetching products:", error);
        return [];
    }
}

export async function getFeaturedProducts() {
    try {
        const result = await payloadSdk.find({
            collection: "products",
            limit: 8,
            where: {
                featured: {
                    equals: true,
                },
            },
            sort: "-createdAt",
        });
        return result.docs;
    } catch (error) {
        console.error("Error fetching featured products:", error);
        return [];
    }
}

export async function getCollections() {
    try {
        const result = await payloadSdk.find({
            collection: "collections",
            limit: 100,
        });
        return result.docs;
    } catch (error) {
        console.error("Error fetching collections:", error);
        return [];
    }
}

export async function getFlashDeals() {
    try {
        const result = await payloadSdk.find({
            collection: "products",
            limit: 6,
            where: {
                and: [
                    {
                        "variants.originalPrice": {
                            exists: true,
                        },
                    },
                    {
                        visible: {
                            equals: true,
                        },
                    },
                ],
            },
            sort: "-createdAt",
        });
        return result.docs;
    } catch (error) {
        console.error("Error fetching flash deals:", error);
        return [];
    }
}

export async function getPromotionalBanners() {
    try {
        const result = await payloadSdk.find({
            collection: "promotional-banners",
            limit: 10,
            where: {
                active: {
                    equals: true,
                },
            },
            sort: "-priority",
        });
        return result.docs;
    } catch (error) {
        console.error("Error fetching promotional banners:", error);
        return [];
    }
}
