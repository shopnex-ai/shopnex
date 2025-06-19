import type { Order } from "@/payload-types";

import config from "@payload-config";
import { getPayload } from "payload";

export const createPendingOrder = async (
    items: any[],
    stripeSessionId: string,
    total: number,
    orderId: string
): Promise<Order> => {
    const orderData: any = {
        currency: "usd",
        items,
        orderId,
        sessionId: stripeSessionId,
        totalAmount: total,
        user: null,
    };

    const payload = await getPayload({ config });
    const order = await payload.create({
        collection: "orders",
        data: orderData,
    });

    if (!order) {
        throw new Error("Failed to create order");
    }

    return order;
};

export const updateOrderStatus = async (
    sessionId: string,
    status: any
): Promise<void> => {
    const payload = await getPayload({ config });

    const result = await payload.update({
        collection: "orders",
        data: {
            orderStatus: status,
        },
        where: {
            stripeSessionId: {
                equals: sessionId,
            },
        },
    });

    if (!result) {
        throw new Error("Failed to update order status");
    }
};

export const getOrder = async (orderId: string) => {
    try {
        const payload = await getPayload({ config });
        const order = await payload.find({
            collection: "orders",
            where: {
                sessionId: {
                    equals: orderId,
                },
            },
        });

        if (!order.docs.length) {
            return null;
        }

        return order.docs[0];
    } catch (error) {
        console.error("Error retrieving order:", error);
        return null;
    }
};

export const getOrders = async () => {
    try {
        const payload = await getPayload({ config });
        const orders = await payload.find({
            collection: "orders",
        });

        if (!orders.docs.length) {
            return [];
        }

        return orders.docs;
    } catch (error) {
        console.error("Error retrieving orders:", error);
        return [];
    }
};
