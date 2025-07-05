import type { StripeWebhookHandler } from "@shopnex/stripe-plugin/types";
import type { Payload } from "payload";

import Stripe from "stripe";

/**
 * This webhook will run whenever a payment intent is successfully paid to create an order in Payload
 */
export const paymentSucceeded: StripeWebhookHandler<{
    data: {
        object: Stripe.PaymentIntent;
    };
    id: string;
}> = async ({ event, payload }) => {
    const { logger } = payload;
    const paymentIntent = event.data.object;

    // Extract relevant details
    const orderId = paymentIntent.metadata?.orderId;
    const customerEmail =
        paymentIntent.receipt_email || paymentIntent.metadata?.email;

    payload.logger.info(
        `🔔 Received Stripe Event: ${event.id}, Order ID: ${orderId}`
    );

    if (!orderId) {
        logger.error("❌ Missing order ID in payment metadata");
        return;
    }

    try {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
            apiVersion: "2022-08-01",
        });
        const charges = await stripe.charges.list({
            payment_intent: paymentIntent.id,
        });
        const latestCharge = charges.data[0];
        const email = latestCharge.billing_details.email;

        const billingDetails = latestCharge?.billing_details;
        const shippingDetails = paymentIntent.shipping || null;

        const userQuery = await payload.find({
            collection: "users",
            where: {
                email: {
                    equals: email,
                },
            },
        });

        // Get the first user (assuming email is unique)
        const user = userQuery.docs[0];
        const result = await payload.update({
            collection: "orders",
            data: {
                billingAddress: billingDetails
                    ? ({
                          name: billingDetails.name,
                          address: billingDetails.address,
                          email: billingDetails.email,
                          phone: billingDetails.phone,
                      } as any)
                    : undefined,
                orderStatus: "processing",
                paymentGateway: "stripe",
                paymentIntentId: paymentIntent.id,
                paymentMethod: paymentIntent.payment_method_types.join(", "),
                paymentStatus: "paid",
                receiptUrl: latestCharge.receipt_url,
                shippingAddress: shippingDetails
                    ? ({
                          name: shippingDetails.name,
                          address: shippingDetails.address,
                          phone: shippingDetails.phone,
                      } as any)
                    : undefined,
                updatedAt: new Date().toISOString(),
                user: user ? user.id : null,
            },
            where: {
                orderId: {
                    equals: orderId,
                },
            },
        });

        if (result.errors.length) {
            throw new Error(result.errors[0].message);
        }

        logger.info(`✅ Payment successful for Order ID: ${orderId}`, result);

        // (Optional) Send confirmation email
        if (customerEmail) {
            sendOrderConfirmationEmail(customerEmail, orderId);
        }
    } catch (error) {
        logger.error("❌ Error updating order status:", error);
    }
};

function sendOrderConfirmationEmail(
    email: string,
    orderId: string,
    logger: Payload["logger"]
) {
    logger.info(
        `📧 Sending confirmation email to ${email} for Order ID: ${orderId}`
    );
}
