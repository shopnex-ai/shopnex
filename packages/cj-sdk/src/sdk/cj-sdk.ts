import { confirmOrder, createOrder, deleteOrder, listOrders, queryOrder } from './orders/orders'
import {
  addToMyProducts,
  getMyProducts,
  getShopProductDetail,
  getShopProducts,
  getProductCategory,
  getProductDetails,
  getProductList,
  getProductInventoryByPid,
  getProductListV2,
  getProductStockByVid,
} from './products/products'
import { calculateFreight, getTrackingInfo } from './logistics/logistics'
import { getSettings } from './settings/settings-api'

import type { CreateOrderPayload, QueryOrderParams } from './orders/order-types.ts'
import type { FreightCalculateParams } from './logistics/logistics-types.ts'
import type { MyProductsParams, ProductListV2Params, ShopProductsParams } from './products/product-types.ts'

export type CjSdk = ReturnType<typeof cjSdk>

export function cjSdk({ accessToken }: { accessToken: string }) {
  return {
    orders: {
      confirmOrder: (orderId: string) => confirmOrder(orderId, accessToken),
      createOrder: (params: CreateOrderPayload, platformToken?: string) =>
        createOrder(params, { accessToken, platformToken }),
      deleteOrder: (orderId: string) => deleteOrder(orderId, accessToken),
      listOrders: (params?: Parameters<typeof listOrders>[1]) => listOrders(accessToken, params),
      queryOrder: (params: QueryOrderParams) => queryOrder(params, accessToken),
    },
    products: {
      // getProductCategory: (params) =>
      //     getProductCategory({ ...params, accessToken }),
      getProductDetails: (params: any) => getProductDetails({ ...params, accessToken }),
      // getProductList: (params) =>
      //     getProductList({ ...params, accessToken }),
      addToMyProducts: (productId: string) => addToMyProducts(accessToken, productId),
      getMyProducts: (params?: MyProductsParams) => getMyProducts(accessToken, params),
      getProductInventoryByPid: (pid: string) => getProductInventoryByPid(accessToken, pid),
      getProductListV2: (params?: ProductListV2Params) => getProductListV2(accessToken, params),
      getProductStockByVid: (params: any) => getProductStockByVid({ ...params, accessToken }),
    },
    shopProducts: {
      getDetail: (shopProductId: string) => getShopProductDetail(accessToken, shopProductId),
      list: (params?: ShopProductsParams) => getShopProducts(accessToken, params),
    },
    logistics: {
      calculateFreight: (params: FreightCalculateParams) => calculateFreight(accessToken, params),
      getTrackingInfo: (trackNumbers: string[]) => getTrackingInfo(accessToken, trackNumbers),
    },
    // settings: {
    //     getSettings: () => getSettings({ accessToken }),
    // },
  }
}
