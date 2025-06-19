import Decimal from "decimal.js";
import Stripe from "stripe";

export const mapToStripeLineItems = (
    variants: {
        gallery: { url: string }[];
        id: string;
        options: { id: string; option: string; value: string }[];
        price: number;
        quantity: number;
    }[]
): Stripe.Checkout.SessionCreateParams.LineItem[] => {
    return variants.map((variant) => {
        return {
            price_data: {
                currency: "usd", // Adjust if needed
                product_data: {
                    name: `Product ${variant.id}`, // Modify if you have actual product names
                    description: variant.options
                        .map((opt) => `${opt.option}: ${opt.value}`)
                        .join(", "),
                    images:
                        variant.gallery.length > 0
                            ? [variant.gallery[0].url]
                            : [],
                },
                unit_amount: +new Decimal(variant.price).times(100).toFixed(0),
            },
            quantity: new Decimal(variant.quantity).toNumber(),
        };
    });
};

export const createCheckoutSession = async (
    lineItems: Stripe.Checkout.SessionCreateParams.LineItem[],
    orderId: string
) => {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
        apiVersion: "2022-08-01",
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
        payment_method_types: ["card"],
        shipping_address_collection: {
            allowed_countries: ["US", "CA", "GB"], // Add the countries you want to support
        },
        success_url: `${process.env.NEXT_PUBLIC_SERVER_URL}/order/confirmed/{CHECKOUT_SESSION_ID}`,
    });
};

export const retrieveSession = async (sessionId: string) => {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
        apiVersion: "2022-08-01",
    });
    return stripe.checkout.sessions.retrieve(sessionId);
};

export const constructWebhookEvent = (
    payload: Buffer | string,
    signature: string
) => {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
        apiVersion: "2022-08-01",
    });
    return stripe.webhooks.constructEvent(
        payload,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET as string
    );
};
