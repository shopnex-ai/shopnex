import type { Config } from "@/payload-types";

import { PayloadSDK } from "@shopnex/payload-sdk";

export const payloadSdk = new PayloadSDK<Config>({
    baseURL: `${process.env.NEXT_PUBLIC_SERVER_URL}/api`,
});
