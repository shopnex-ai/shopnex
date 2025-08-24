import { getPayload } from "payload";
import Stripe from "stripe";

import { getCachedGlobal } from "@/utilities/getGlobals";
import config from "@payload-config";

export async function POST(req: Request) {
  try {
    const sig = req.headers.get("stripe-signature") ?? "";

    const { stripe: stripeOptions } = await getCachedGlobal("paywalls", "en", 1)();
    const secret = stripeOptions?.secret;

    const endpointSecret = stripeOptions?.webhookSecret ?? "";

    if (!secret) {
      return Response.json({ status: 400 });
    }

    const payload = await getPayload({ config });

    const rawBody = await req.text();

    const stripe = new Stripe(secret);

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
    } catch (error) {
      if (error instanceof Error) {
        return new Response(`Webhook Error: ${error.message}`, { status: 400 });
      }
      return new Response("Webhook Error: Unknown error", { status: 400 });
    }
    switch (event.type) {
      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object;
        const orderID = paymentIntent.metadata.orderID;

        if (paymentIntent.status === "succeeded") {
          void payload.update({
            collection: "orders",
            id: orderID,
            data: {
              orderDetails: {
                status: "paid",
                transactionID: paymentIntent.id,
                amountPaid: paymentIntent.amount_received / 100,
              },
            },
          });
        }

        break;
      }
      case "payment_intent.payment_failed":
      case "payment_intent.canceled": {
        const paymentIntent = event.data.object;
        const orderID = paymentIntent.metadata.orderID;
        if (paymentIntent.status !== "succeeded") {
          void payload.update({
            collection: "orders",
            id: orderID,
            data: {
              orderDetails: {
                status: "unpaid",
                transactionID: paymentIntent.id,
              },
            },
          });
        }
        break;
      }
      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    return Response.json({ status: 200 });
  } catch (error) {
    if (error instanceof Error) {
      return new Response(`Webhook Error: ${error.message}`, { status: 400 });
    }
    return new Response("Webhook Error: Unknown error", { status: 400 });
  }
}
