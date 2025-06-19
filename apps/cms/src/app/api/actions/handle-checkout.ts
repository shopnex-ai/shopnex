"use server";

import Decimal from "decimal.js";

import type { CheckoutResult } from "./checkout-types";

import { createPendingOrder, updateOrderStatus } from "../services/orders";
import { getVariants } from "../services/products";
import {
    createCheckoutSession,
    mapToStripeLineItems,
    retrieveSession,
} from "./stripe";

export async function handleCheckout(items: any[]): Promise<CheckoutResult> {
    const variantIds = items.map((item) => item.id);
    const variants = await getVariants(variantIds);
    const variantsWithQty = variants.map((variant) => ({
        ...variant,
        quantity: items.find((item) => item.id === variant.id)?.quantity || 0,
    }));

    const total = variantsWithQty.reduce(
        (sum, variant) =>
            sum.plus(new Decimal(variant.price).times(variant.quantity)),
        new Decimal(0)
    );
    const orderItems = variantsWithQty.map((variant) => ({
        product: variant.product,
        quantity: variant.quantity,
        totalPrice: +total,
        variant: {
            name: variant.options.map((opt: any) => opt.value).join(" / "),
            price: variant.price,
            variantId: variant.vid,
        },
    }));

    try {
        const orderId = `ORD-${Date.now().toString()}`;
        const lineItems = mapToStripeLineItems(variantsWithQty);

        const session = await createCheckoutSession(lineItems, orderId);

        if (!session?.url || !session?.id) {
            throw new Error("Failed to create checkout session");
        }

        await createPendingOrder(orderItems, session.id, +total, orderId);

        return {
            sessionId: session.id,
            url: session.url,
        };
    } catch (error) {
        console.error("Stripe Checkout Error:", error);

        const errorMessage =
            error instanceof Error
                ? error.message
                : "An unexpected error occurred during checkout";

        return {
            error: `Checkout failed: ${errorMessage}`,
        };
    }
}
