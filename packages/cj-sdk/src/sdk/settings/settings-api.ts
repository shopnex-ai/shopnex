import type { CJApiResponse } from "../../types";
import type { AccountSettings } from "./settings-types";

import { cjApiClient } from "../../api-client";

export async function getSettings(
    accessToken: string
): Promise<AccountSettings> {
    try {
        const response = await cjApiClient.get<CJApiResponse<AccountSettings>>(
            "setting/get",
            {
                headers: { "CJ-Access-Token": accessToken },
            }
        );

        const result = response.data.data;
        if (!result) {
            throw new Error("No settings found");
        }

        return result;
    } catch (error: any) {
        console.error(
            `Error fetching settings [${error.code}]: ${error.message}`
        );
        throw error;
    }
}
