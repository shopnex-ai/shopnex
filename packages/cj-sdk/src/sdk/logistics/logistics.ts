import type { APIResponse } from "../../error-types";
import type { CJApiResponse } from "../../types";
import type { FreightCalculateParams, TrackInfo } from "./logistics-types.ts";

import { cjApiClient } from "../../api-client";

export async function calculateFreight(
    accessToken: string,
    params: FreightCalculateParams
): Promise<APIResponse<any[]>> {
    try {
        const response = await cjApiClient.post<CJApiResponse<any[]>>(
            "logistic/freightCalculate",
            params,
            { headers: { "CJ-Access-Token": accessToken } }
        );

        if (!response.data.result) {
            return {
                error: response.data.message || "Failed to calculate freight",
            };
        }

        return { data: response.data.data ?? [] };
    } catch (error: any) {
        console.error(
            `Error calculating freight [${error.code}]: ${error.message}`
        );
        return { error: error.message || "An unknown error occurred" };
    }
}

export async function getTrackingInfo(
    accessToken: string,
    trackNumbers: string[]
): Promise<APIResponse<TrackInfo[]>> {
    try {
        const response = await cjApiClient.get<CJApiResponse<TrackInfo[]>>(
            "logistic/trackInfo",
            {
                headers: { "CJ-Access-Token": accessToken },
                params: { trackNumber: trackNumbers },
                // trackNumber=a&trackNumber=b
                paramsSerializer: { indexes: null },
            }
        );

        if (!response.data.result) {
            return {
                error: response.data.message || "Failed to fetch tracking info",
            };
        }

        return { data: response.data.data ?? [] };
    } catch (error: any) {
        console.error(
            `Error fetching tracking info [${error.code}]: ${error.message}`
        );
        return { error: error.message || "An unknown error occurred" };
    }
}
