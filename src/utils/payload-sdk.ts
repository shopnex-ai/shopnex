import type { Config } from "@/payload-types";

import { PayloadSDK } from "@shopnex/payload-sdk";
import { cookies } from "next/headers";

export const payloadSdk = new PayloadSDK<Config>({
    baseURL: `${process.env.NEXT_PUBLIC_SERVER_URL}/api`,
    fetch: async (input, init) => {
        const cookieHeader = await cookies();
        const tenantId = cookieHeader.get("payload-tenant")?.value;
        const res = await fetch(input, {
            ...init,
            headers: {
                ...init?.headers,
                "Content-Type": "application/json",
                "X-Requested-With": "XMLHttpRequest",
                "x-tenant-id": tenantId || "",
            },
        });

        if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`);
        }

        return res;
    },
});
