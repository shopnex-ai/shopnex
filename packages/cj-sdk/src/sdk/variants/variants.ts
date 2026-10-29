import type { APIResponse } from "../../error-types";
import type { CJApiResponse } from "../../types";
import type { Variant } from "./variant-types.js";

import { cjApiClient } from "../../api-client";
import { getCurrentAccessToken } from "../access-token";

export async function getAllVariants(queryParams: {
    pid?: string;
    productSku?: string;
    variantSku?: string;
}): Promise<APIResponse<Variant[]>> {
    if (
        !queryParams.pid &&
        !queryParams.productSku &&
        !queryParams.variantSku
    ) {
        return {
            error: "One of pid, productSku, or variantSku must be provided.",
        };
    }

    try {
        const accessToken = await getCurrentAccessToken(); // Ensure you populate this with a valid token
        const response = await cjApiClient.get<CJApiResponse<Variant[]>>(
            "product/variant/query",
            {
                headers: {
                    "CJ-Access-Token": accessToken,
                },
                params: queryParams,
            }
        );

        if (!response.data.result) {
            return {
                error: response.data.message || "Failed to fetch variants",
            };
        }

        if (!response.data.data) {
            return { error: "No variants found" };
        }

        return { data: response.data.data };
    } catch (error: any) {
        console.error(
            `Error fetching all variants [${error.code}]: ${error.message}`
        );
        return { error: error.message || "An unknown error occurred" };
    }
}

export async function getVariantById(
    vid: string
): Promise<APIResponse<Variant>> {
    if (!vid) {
        return { error: "vid must be provided." };
    }

    try {
        const accessToken = await getCurrentAccessToken(); // Ensure you populate this with a valid token
        const response = await cjApiClient.get<CJApiResponse<Variant>>(
            "product/variant/queryByVid",
            {
                headers: {
                    "CJ-Access-Token": accessToken,
                },
                params: { vid },
            }
        );

        if (!response.data.result) {
            return {
                error: response.data.message || "Failed to fetch variant by ID",
            };
        }

        if (!response.data.data) {
            return { error: "No variant found" };
        }

        return { data: response.data.data };
    } catch (error: any) {
        console.error(
            `Error fetching variant by ID [${error.code}]: ${error.message}`
        );
        return { error: error.message || "An unknown error occurred" };
    }
}
