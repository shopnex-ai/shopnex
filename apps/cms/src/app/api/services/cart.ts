import config from "@payload-config";
import { getPayload } from "payload";

export const setAddresses = (cartId: string, addresses: any) => {
    return null;
};

export const retrieveCart = async () => {
    const payload = await getPayload({ config });
    const cart = await payload.find({
        collection: "carts",
        // overrideAccess: false,
    });
    return cart.docs[0];
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
