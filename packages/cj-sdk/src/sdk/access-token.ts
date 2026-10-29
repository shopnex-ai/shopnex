import { getAccessToken, refreshAccessToken } from "./auth";

type Credentials = {
    accessToken?: string;
    apiKey: string;
    refreshToken?: string;
};

const tenantCredentialsMap = new Map<string, Credentials>();

export const getCurrentAccessToken = async () => {
    const shopId = "1";
    const accessToken = await getTenantAccessToken(shopId);
    return accessToken;
};

export const setTenantCredentials = (
    shopId: string,
    credentials: Credentials
) => {
    tenantCredentialsMap.set(shopId, credentials);
};

export const getTenantAccessToken = async (shopId: string) => {
    const credentials = tenantCredentialsMap.get(shopId) || {
        apiKey: process.env.CJ_API_KEY || "",
        refreshToken: process.env.CJ_REFRESH_TOKEN || "",
    };

    if (credentials.accessToken) {
        return credentials.accessToken;
    }

    if (!credentials?.apiKey) {
        throw new Error(
            `Credentials for tenant ${shopId} are missing or incomplete`
        );
    }

    const { apiKey, refreshToken } = credentials;

    let newAccessToken: string;
    let newRefreshToken: string | undefined;

    if (!refreshToken) {
        const result = await getAccessToken(apiKey);
        newAccessToken = result.accessToken;
        newRefreshToken = result.refreshToken;
    } else {
        const result = await refreshAccessToken(refreshToken);
        newAccessToken = result.accessToken;
        newRefreshToken = result.refreshToken;
    }

    tenantCredentialsMap.set(shopId, {
        ...credentials,
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
    });

    return newAccessToken;
};
