import type { Product } from "@/payload-types";

export const mapProducts = (products: Product[]) => {
    return products
        .map((product) => ({
            ...product,
            variants: product.variants?.map((variant) => ({
                ...variant,
                imageUrl:
                    variant.imageUrl ||
                    (typeof variant.gallery?.[0] === "object"
                        ? variant.gallery[0].url
                        : undefined),
            })),
        }))
        .filter((product) => product.visible);
};
