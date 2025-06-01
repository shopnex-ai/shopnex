import config from "@payload-config";
import { getPayload } from "payload";

import collections from "./collections.json";
import globals from "./globals.json";
import products from "./products.json";

const seed = async () => {
    const payload = await getPayload({ config });

    await payload.updateGlobal({
        slug: "store-settings",
        data: {
            name: "ShopNex",
            currency: "USD",
        },
    });

    const backgroundImage = await payload.create({
        collection: "media",
        data: {
            alt: "watch",
            createdAt: "2025-04-20T04:59:11.487Z",
            filename: `watch-${Date.now()}.png`,
            filesize: 1077498,
            focalX: 50,
            focalY: 50,
            height: 1024,
            mimeType: "image/png",
            thumbnailURL:
                "https://pub-e0a548fa3e234baf8e41a8fd95bb8ad5.r2.dev/shopnex-images/media/watch-hero.png",
            updatedAt: "2025-04-20T04:59:11.486Z",
            url: "https://pub-e0a548fa3e234baf8e41a8fd95bb8ad5.r2.dev/shopnex-images/media/watch-hero.png",
            width: 1024,
        },
    });

    await payload.updateGlobal({
        slug: "hero-section",
        data: {
            type: [
                {
                    ctaButtonLink: "/store",
                    ctaButtonText: "Shop Now",
                    subtitle: "With Timeless Men's Watches",
                    title: "Elevate Your Style",

                    backgroundImage: backgroundImage.id,
                    blockName: null,
                    blockType: "hero",
                },
            ],
        },
    });

    await payload.updateGlobal({
        slug: "footer",
        data: {
            type: [
                {
                    blockName: null,
                    blockType: "basic-footer",
                    copyright: (globals[1].type[0] as any).copyright,
                    poweredBy: (globals[1].type[0] as any).poweredBy,
                },
            ],
        },
    });

    const collectionResults = await Promise.all(
        collections.map((collection: any) =>
            payload.create({
                collection: "collections",
                data: collection,
            })
        )
    );

    const productCollectionIds = [
        collectionResults[0].id,
        collectionResults[0].id,
        collectionResults[0].id,
        collectionResults[1].id,
        collectionResults[1].id,
        collectionResults[2].id,
    ];

    await Promise.all(
        products.map(async (product: any, index: number) => {
            for (const variant of product.variants || []) {
                const filename = variant?.imageUrl?.split("/").pop();
                if (!filename || !variant.imageUrl) {
                    continue;
                }
                const alt = filename.split(".")[0];
                const imageUrl = variant.imageUrl;

                const imageResult = await payload.create({
                    collection: "media",
                    data: {
                        alt,
                        filename,
                        thumbnailURL: imageUrl,
                        url: imageUrl,
                    },
                });
                variant.imageUrl = imageResult.url;
                variant.gallery = [imageResult.id];
            }

            const productResult = await payload.create({
                collection: "products",
                data: {
                    ...product,
                    collections: productCollectionIds[index],
                },
            });

            console.log(`Created product: ${productResult.id}`);
        })
    );
};

console.log("Seeding...");
await seed();
console.log("Seeding complete!");
process.exit(0);
