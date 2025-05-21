import config from "@payload-config";
import { unstable_cache } from "next/cache";
import { getPayload, Sort } from "payload";

export const getTopCollections = unstable_cache(
    async () => {
        const payload = await getPayload({ config });
        const collections = await payload.find({
            collection: "collections",
            limit: 3,
        });
        return collections.docs;
    },
    ["get-top-collections"],
    {
        revalidate: 60,
    }
);
