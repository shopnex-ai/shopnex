import { payloadSdk } from "@/utils/payload-sdk";
import type { Order } from "@shopnex/types";

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

    const order = await payloadSdk.create({
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
    const result = await payloadSdk.update({
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
        const order = await payloadSdk.find({
            collection: "orders",
            depth: 5,
            where: {
                sessionId: {
                    equals: orderId,
                },
            },
        });

        if (!order.docs?.length) {
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
        const orders = await payloadSdk.find({
            collection: "orders",
        });

        if (!orders?.docs?.length) {
            return [];
        }

        return orders.docs;
    } catch (error) {
        console.error("Error retrieving orders:", error);
        return [];
    }
};
