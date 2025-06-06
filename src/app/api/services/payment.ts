import { payloadSdk } from "@/utils/payload-sdk";
import { getPayload } from "payload";

export const listCartPaymentMethods = async () => {
    const payments = await payloadSdk.find({
        collection: "payments",
    });
    return payments;
};
