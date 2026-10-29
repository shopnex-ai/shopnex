import {
    confirmOrder,
    createOrder,
    deleteOrder,
    listOrders,
    queryOrder,
} from "./orders/orders";
import {
    getProductCategory,
    getProductDetails,
    getProductList,
    getProductInventoryByPid,
    getProductListV2,
    getProductStockByVid,
} from "./products/products";
import { calculateFreight, getTrackingInfo } from "./logistics/logistics";
import { getSettings } from "./settings/settings-api";

import type { FreightCalculateParams } from "./logistics/logistics-types.ts";
import type { ProductListV2Params } from "./products/product-types.ts";

export type CjSdk = ReturnType<typeof cjSdk>;

export function cjSdk({ accessToken }: { accessToken: string }) {
    return {
        orders: {
            confirmOrder: (params: any) =>
                confirmOrder({ ...params, accessToken }),
            createOrder: (params: any) =>
                createOrder({ ...params, accessToken }),
            deleteOrder: (params: any) =>
                deleteOrder({ ...params, accessToken }),
            listOrders: (params: any) => listOrders({ ...params, accessToken }),
            queryOrder: (params: any) => queryOrder({ ...params, accessToken }),
        },
        products: {
            // getProductCategory: (params) =>
            //     getProductCategory({ ...params, accessToken }),
            getProductDetails: (params: any) =>
                getProductDetails({ ...params, accessToken }),
            // getProductList: (params) =>
            //     getProductList({ ...params, accessToken }),
            getProductInventoryByPid: (pid: string) =>
                getProductInventoryByPid(accessToken, pid),
            getProductListV2: (params?: ProductListV2Params) =>
                getProductListV2(accessToken, params),
            getProductStockByVid: (params: any) =>
                getProductStockByVid({ ...params, accessToken }),
        },
        logistics: {
            calculateFreight: (params: FreightCalculateParams) =>
                calculateFreight(accessToken, params),
            getTrackingInfo: (trackNumbers: string[]) =>
                getTrackingInfo(accessToken, trackNumbers),
        },
        // settings: {
        //     getSettings: () => getSettings({ accessToken }),
        // },
    };
}
