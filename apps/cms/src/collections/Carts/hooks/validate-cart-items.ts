import type { Cart } from "@shopnex/types";
import type { FieldHook } from "payload";

export const validateCartItems: FieldHook<Cart> = async ({ req, value }) => {
    if (!value || !Array.isArray(value)) {
        return value;
    }

    const errors = [];

    for (const item of value) {
        const { quantity, variantId } = item;

        if (!variantId || typeof quantity !== "number") {
            continue;
        }

        const productQuery = await req.payload.db.findOne({
            collection: "products",
            where: {
                "variants.vid": { equals: variantId },
            },
        });

        const product = productQuery?.docs?.[0];

        if (!product) {
            errors.push(`Product with variant ${variantId} not found.`);
            continue;
        }

        const variant = product.variants.find((v: any) => v.vid === variantId);

        if (!variant) {
            errors.push(`Variant ${variantId} not found.`);
            continue;
        }

        if ((variant.stockCount ?? 0) < quantity) {
            errors.push(
                `Not enough stock for variant ${variantId}. Only ${variant.stockCount ?? 0} left.`
            );
        }
    }

    if (errors.length > 0) {
        throw new Error(errors.join(" "));
    }

    return value;
};
