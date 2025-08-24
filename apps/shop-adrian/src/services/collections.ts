import { payloadSdk } from "@/utils/payload-sdk";

export const getTopCollections = async () => {
    const collections = await payloadSdk.find({
        collection: "collections",
        limit: 3,
    });
    return collections.docs;
};
