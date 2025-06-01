import { payloadSdk } from "@/utils/payload-sdk";

export const fetchTopCollections = async () => {
    const collections = await payloadSdk.find(
        {
            collection: "collections",
            limit: 3,
        },
        {
            next: {
                revalidate: 60,
            },
        }
    );
    return collections.docs;
};
