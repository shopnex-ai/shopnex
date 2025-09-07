import type { Config } from "@shopnex/types";

import { PayloadSDK } from "@shopnex/payload-sdk";

const isBrowser = typeof window !== "undefined";

export const payloadSdk = new PayloadSDK<Config>({
    baseInit: {
        credentials: "include", // Add this line to include cookies
    },
    baseURL: `${process.env.NEXT_PUBLIC_SERVER_URL}/api`,
    fetch: isBrowser ? (...args) => window.fetch(...args) : undefined,
});
