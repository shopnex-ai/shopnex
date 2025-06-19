import config from "@payload-config";
import { getPayload } from "payload";

export const getStoreSettings = async () => {
    const payload = await getPayload({ config });
    const storeSettings = await payload.findGlobal({
        slug: "store-settings",
    });

    return storeSettings;
};
