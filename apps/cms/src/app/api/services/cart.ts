import { payloadSdk } from "@/utils/payload-sdk";
import config from "@payload-config";
import { get } from "lodash";
import { getPayload } from "payload";

export const setAddresses = (cartId: string, addresses: any) => {
    return null;
};

export const getCart = async () => {
    const cart = await payloadSdk.find({
        collection: "carts",
    });
    return cart.docs?.[0];
};

export const initiatePaymentSession = (cartId: string, data: any) => {
    return {};
};

export const placeOrder = (cartId: string, data: any) => {
    return {};
};

export const setShippingMethod = ({ cartId, shippingMethodId }: any) => {
    return {};
};

export async function createCart(item: { id: string; quantity: number }) {
    await payloadSdk.create({
        collection: "carts",
        data: {
            cartItems: [
                {
                    variantId: item.id,
                    quantity: item.quantity,
                },
            ],
        },
    });
}

export async function updateCart(item: { id: string; quantity: number }) {
    const cartResult = await getCart();

    const existingItems = cartResult?.cartItems || [];
    const existingItemIndex = existingItems.findIndex(
        (cartItem: any) => cartItem.variantId === item.id
    );

    let updatedCartItems;

    if (item.quantity === 0) {
        updatedCartItems = existingItems.filter(
            (cartItem: any) => cartItem.variantId !== item.id
        );
    } else if (existingItemIndex > -1) {
        updatedCartItems = existingItems.map((cartItem: any, index: number) => {
            if (index === existingItemIndex) {
                return {
                    ...cartItem,
                    quantity: item.quantity,
                };
            }
            return cartItem;
        });
    } else {
        updatedCartItems = [
            ...existingItems,
            {
                variantId: item.id,
                quantity: item.quantity,
            },
        ];
    }

    await payloadSdk.update({
        collection: "carts",
        data: {
            cartItems: updatedCartItems,
        },
        where: {
            sessionId: {
                equals: cartResult.sessionId,
            },
        },
    });
}
