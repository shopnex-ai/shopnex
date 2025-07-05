import type { Product } from "@/payload-types";
import type { Order } from "@shopnex/types";

import { mapToStripeLineItems } from "@/app/api/actions/stripe";
import { createPendingOrder } from "@/app/api/services/orders";
import { getVariants } from "@/app/api/services/products";
import Decimal from "decimal.js";
import { type Endpoint, parseCookies, type PayloadRequest } from "payload";
import Stripe from "stripe";

interface CartItem {
    id: string;
    quantity: number;
}

interface CheckoutRequest {
    cartItems: CartItem[];
    customer: any;
    paymentMethod: "manualProvider" | "stripe";
    shippingMethod: {
        cost: number;
    };
}

interface OrderItem {
    product: Product;
    quantity: number;
    totalPrice: number;
    variant: {
        name: string;
        price: number;
        variantId: string;
    };
}

interface VariantsWithQty {
    id: string;
    name: string;
    options: any[];
    price: number;
    product: Product;
    quantity: number;
}

const calculateOrderTotals = (
    variantsWithQty: VariantsWithQty[],
    shippingCost: number
) => {
    const subtotal = variantsWithQty.reduce(
        (sum, variant) =>
            sum.plus(new Decimal(variant.price).times(variant.quantity)),
        new Decimal(0)
    );
    const total = subtotal.plus(new Decimal(shippingCost));

    return { subtotal: +subtotal, total: +total };
};

export const createCheckoutSession = async (
    lineItems: Stripe.Checkout.SessionCreateParams.LineItem[],
    orderId: string
) => {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
        apiVersion: "2025-02-24.acacia",
    });
    return stripe.checkout.sessions.create({
        cancel_url: `${process.env.NEXT_PUBLIC_SERVER_URL}/cart?canceled=true`,
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // Expires in 30 minutes
        line_items: lineItems,
        metadata: {
            cartItemCount: lineItems.length.toString(),
            orderId,
        },
        mode: "payment",
        payment_intent_data: {
            metadata: {
                orderId,
            },
            setup_future_usage: "off_session",
        },
        // payment_method_types: ["card"],
        success_url: `${process.env.NEXT_PUBLIC_SERVER_URL}/order/confirmed/{CHECKOUT_SESSION_ID}`,
    });
};

const createOrderItems = (
    variantsWithQty: VariantsWithQty[],
    total: number
): OrderItem[] => {
    return variantsWithQty.map((variant) => ({
        product: variant.product,
        quantity: variant.quantity,
        totalPrice: total,
        variant: {
            name: variant.options.map((opt) => opt.value).join(" / "),
            price: variant.price,
            variantId: variant.id,
        },
    }));
};

const validateCartItems = async (cartItems: CartItem[], logger: any) => {
    const variantIds = cartItems.map((item) => item.id);
    const variants = await getVariants(variantIds);

    if (!variants.length) {
        logger.error("No valid variants found for checkout");
        throw new Error("Invalid product variants.");
    }

    return variants.map((variant) => ({
        ...variant,
        quantity:
            cartItems.find((item) => item.id === variant.id)?.quantity || 0,
    }));
};

const createOrder = async (
    req: PayloadRequest,
    orderData: Omit<Order, "createdAt" | "id" | "updatedAt">
) => {
    return await req.payload.create({
        collection: "orders",
        data: orderData,
        req,
    });
};

export const checkoutEndpoint: Endpoint = {
    handler: async (req) => {
        const { logger } = req.payload;
        const cookies = parseCookies(req.headers);

        const cartSessionId = cookies.get("cart-session");
        const cartId = cartSessionId ? +cartSessionId : null;
        const orderId = `ORD-${Date.now().toString()}`;
        try {
            if (!req.json) {
                logger.error("Checkout failed - Invalid request body");
                return Response.json(
                    { error: "Invalid request body." },
                    { status: 400 }
                );
            }

            const body: CheckoutRequest = await req.json();
            const { cartItems, customer, paymentMethod, shippingMethod } = body;

            logger.info("Processing checkout", {
                customerId: customer?.id,
                itemCount: cartItems?.length,
                paymentMethod,
            });

            const variantsWithQty = await validateCartItems(cartItems, logger);
            logger.info("Validated variants", {
                variantCount: variantsWithQty.length,
                variantsWithQty,
            });

            const { subtotal, total } = calculateOrderTotals(
                variantsWithQty,
                shippingMethod?.cost || 0
            );

            logger.info("Calculated order totals", {
                subtotal,
                total,
            });

            if (paymentMethod === "manualProvider") {
                const sessionId = `SID-${crypto.randomUUID()}`;
                const order = await createOrder(req, {
                    cart: cartId,
                    currency: "usd",
                    orderId,
                    orderStatus: "shipped",
                    paymentGateway: "manual",
                    paymentMethod,
                    paymentStatus: "paid",
                    sessionId,
                    totalAmount: total,
                });

                logger.info("Created and completed manual order", {
                    orderId: order.id,
                });

                return Response.json({
                    redirectUrl: `${process.env.NEXT_PUBLIC_SERVER_URL}/order/confirmed/${sessionId}`,
                });
            }

            if (paymentMethod === "stripe") {
                logger.info("Processing Stripe payment", { orderId });
                const lineItems = mapToStripeLineItems(variantsWithQty);
                const session = await createCheckoutSession(lineItems, orderId);

                await createOrder(req, {
                    cart: cartId,
                    currency: "usd",
                    orderId,
                    orderStatus: "pending",
                    paymentGateway: "stripe",
                    paymentMethod,
                    paymentStatus: "pending",
                    sessionId: session.id,
                    totalAmount: total,
                });
                logger.info("Created Stripe checkout session", {
                    orderId,
                    sessionId: session.id,
                });
                return Response.json({
                    redirectUrl: session.url,
                });
            }

            return Response.json({
                redirectUrl: `${process.env.NEXT_PUBLIC_SERVER_URL}/order-success?orderId=${order.id}`,
            });
        } catch (error) {
            if (error instanceof Error) {
                logger.error("Checkout error", { error });
                return Response.json({ error: error.message }, { status: 400 });
            } else {
                logger.error("Checkout error", { error: String(error) });
                return Response.json(
                    { error: "Checkout failed." },
                    { status: 500 }
                );
            }
        }
    },
    method: "post",
    path: "/checkout",
};
