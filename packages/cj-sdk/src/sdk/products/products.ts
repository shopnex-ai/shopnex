import type { APIResponse } from "../../error-types";
import type {
    CategoryFirstLevel,
    CategoryListResponse,
    Product,
    ProductDetails,
    ProductInventory,
    ProductListResponse,
    ProductListV2Data,
    ProductListV2Params,
    StockInfo,
} from "./product-types.ts";

import { cjApiClient } from "../../api-client";
import { getCurrentAccessToken } from "../access-token";

export async function getProductCategory(
    accessToken: string,
    params: any
): Promise<APIResponse<CategoryFirstLevel[]>> {
    try {
        const response = await cjApiClient.get<CategoryListResponse>(
            "/product/getCategory",
            {
                headers: { "CJ-Access-Token": accessToken },
                params,
            }
        );

        const data = response.data.data;
        if (!data) {
            return { error: "No categories found" };
        }

        return { data };
    } catch (error: any) {
        console.error(
            `Error fetching categories [${error.code}]: ${error.message}`
        );
        return { error: error.message || "Failed to fetch categories" };
    }
}

export async function getProductList(
    params: Record<string, any> = {}
): Promise<APIResponse<Product[]>> {
    const defaultParams = {
        pageNum: 1,
        pageSize: 20,
    };
    const query = { ...defaultParams, ...params };

    try {
        const accessToken = await getCurrentAccessToken();
        const response = await cjApiClient.get<ProductListResponse>(
            "https://developers.cjdropshipping.com/api2.0/v1/product/list",
            {
                headers: {
                    "CJ-Access-Token": accessToken,
                },
                params: query,
            }
        );

        const data = response.data;

        if (!data.result) {
            return { error: data.message || "Failed to fetch product list" };
        }

        if (!data.data?.list) {
            return { error: "No products found" };
        }

        return { data: data.data.list };
    } catch (error: any) {
        console.error(
            `Error fetching product list [${error.code}]: ${error.message}`
        );
        return { error: error.message || "Failed to fetch product list" };
    }
}

export async function getProductDetails(queryParams: {
    accessToken: string;
    pid?: string;
    productSku?: string;
    variantSku?: string;
}): Promise<APIResponse<ProductDetails>> {
    const { accessToken, pid, productSku, variantSku } = queryParams;
    if (!pid && !productSku && !variantSku) {
        return {
            error: "One of pid, productSku, or variantSku must be provided.",
        };
    }

    try {
        const response = await cjApiClient.get<{
            code: number;
            data: ProductDetails;
            message: string;
            result: boolean;
        }>("https://developers.cjdropshipping.com/api2.0/v1/product/query", {
            headers: {
                "CJ-Access-Token": accessToken,
            },
            params: queryParams,
        });

        if (!response.data.result) {
            return {
                error:
                    response.data.message || "Failed to fetch product details",
            };
        }

        return { data: response.data.data };
    } catch (error: any) {
        console.error(
            `Error fetching product details [${error.code}]: ${error.message}`
        );
        throw new Error(error.message);
    }
}

export async function getProductStockByVid({
    accessToken,
    vid,
}: {
    accessToken: string;
    vid: string;
}): Promise<APIResponse<StockInfo[]>> {
    try {
        const response = await cjApiClient.get<{
            code: number;
            data: StockInfo[];
            message: string;
            result: boolean;
        }>("/product/stock/queryByVid", {
            headers: {
                "CJ-Access-Token": accessToken,
            },
            params: { vid },
        });

        if (!response.data.result) {
            return {
                error:
                    response.data.message ||
                    "Failed to fetch stock information",
            };
        }

        return { data: response.data.data };
    } catch (error: any) {
        console.error(
            `Error fetching stock by VID [${error.code}]: ${error.message}`
        );
        return { error: error.message || "Failed to fetch stock information" };
    }
}

export async function getProductStockBySku(
    sku: string,
    accessToken: string
): Promise<APIResponse<StockInfo[]>> {
    try {
        const response = await cjApiClient.get<{
            code: number;
            data: StockInfo[];
            message: string;
            result: boolean;
        }>("/product/stock/queryBySku", {
            headers: {
                "CJ-Access-Token": accessToken,
            },
            params: { sku },
        });

        if (!response.data.result) {
            return {
                error:
                    response.data.message ||
                    "Failed to fetch stock information",
            };
        }

        return { data: response.data.data };
    } catch (error: any) {
        console.error(
            `Error fetching stock by SKU [${error.code}]: ${error.message}`
        );
        return { error: error.message || "Failed to fetch stock information" };
    }
}

export async function getProductListV2(
    accessToken: string,
    params: ProductListV2Params = {}
): Promise<APIResponse<ProductListV2Data>> {
    try {
        const response = await cjApiClient.get<{
            code: number;
            data: ProductListV2Data;
            message: string;
            result: boolean;
        }>("/product/listV2", {
            headers: { "CJ-Access-Token": accessToken },
            params,
            // lv2categoryList=a&lv2categoryList=b, features=x&features=y
            paramsSerializer: { indexes: null },
        });

        if (!response.data.result) {
            return {
                error: response.data.message || "Failed to fetch products",
            };
        }

        return { data: response.data.data };
    } catch (error: any) {
        console.error(
            `Error fetching product list V2 [${error.code}]: ${error.message}`
        );
        return { error: error.message || "Failed to fetch products" };
    }
}

export async function getProductInventoryByPid(
    accessToken: string,
    pid: string
): Promise<APIResponse<ProductInventory>> {
    try {
        const response = await cjApiClient.get<{
            code: number;
            data: ProductInventory;
            message: string;
            result: boolean;
        }>("/product/stock/getInventoryByPid", {
            headers: { "CJ-Access-Token": accessToken },
            params: { pid },
        });

        if (!response.data.result) {
            return {
                error:
                    response.data.message ||
                    "Failed to fetch stock information",
            };
        }

        return { data: response.data.data };
    } catch (error: any) {
        console.error(
            `Error fetching stock by PID [${error.code}]: ${error.message}`
        );
        return { error: error.message || "Failed to fetch stock information" };
    }
}
