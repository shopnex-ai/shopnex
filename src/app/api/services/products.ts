import config from "@payload-config";
import { unstable_cache } from "next/cache";
import { getPayload } from "payload";

export const getVariants = async (variantIds: string[]) => {
    const payload = await getPayload({ config });

    const products = await payload.find({
        collection: "products",
        where: {
            "variants.id": {
                in: variantIds,
            },
        },
    });

    const variantsMap = new Map<string, any>();

    for (const product of products.docs) {
        for (const variant of product.variants) {
            if (variantIds.includes(variant.id || "")) {
                // Ensure gallery exists and defaults to product images if empty
                const variantGallery =
                    variant.gallery?.map((img: any) => img.url) || [];
                const firstVariantGallery =
                    product.variants[0]?.gallery?.map((img: any) => img.url) ||
                    [];

                variantsMap.set(variant.id || "", {
                    ...variant,
                    gallery:
                        variantGallery.length > 0
                            ? variantGallery
                            : firstVariantGallery,
                    imageUrl: variant.imageUrl || firstVariantGallery[0],
                    product: product.id,
                });
            }
        }
    }

    return variantIds.map((id) => variantsMap.get(id)).filter(Boolean);
};

export const getProducts = unstable_cache(
    async () => {
        const payload = await getPayload({ config });
        const products = await payload.find({
            collection: "products",
            where: { visible: { equals: true } },
        });
        return products.docs;
    },
    ["get-products"], // cache key
    {
        revalidate: 60, // match your page revalidate time
    }
);

export const getProduct = (handle: string) => {
    return unstable_cache(
        async () => {
            const payload = await getPayload({ config });
            const product = await payload.find({
                collection: "products",
                limit: 1,
                where: {
                    handle: {
                        equals: handle,
                    },
                },
            });

            return product.docs[0];
        },
        ["get-product", handle],
        { revalidate: 60 }
    );
};

export const getPaginatedProducts = async ({
    collectionId,
    limit = 12,
    page = 1,
    productsIds,
    sortBy,
}: {
    collectionId?: string;
    limit?: number;
    page?: number;
    productsIds?: string[];
    sortBy?: string;
}) => {
    const payload = await getPayload({ config });

    let where = {};

    if (collectionId) {
        where = {
            ...where,
            "collection.id": {
                equals: collectionId,
            },
        };
    }

    if (productsIds && productsIds.length > 0) {
        where = {
            ...where,
            id: {
                in: productsIds,
            },
        };
    }

    const [sortName, sortDirection] = sortBy?.split("_") || [];

    const sort =
        sortDirection === "asc"
            ? `variants.[0].${sortName}`
            : `-variants.[0].${sortName}`;

    const products = await payload.find({
        collection: "products",
        limit,
        page,
        sort,
        where,
    });

    return {
        docs: products.docs,
        limit: products.limit,
        page: products.page,
        total: products.totalDocs,
        // pages: products.pages,
    };
};
