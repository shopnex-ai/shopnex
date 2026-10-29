// One of vid or sku is required; when both are given they must be the same variant.
export interface OrderProduct {
  podProperties?: string
  quantity: number
  sku?: string
  storeLineItemId?: string
  storeProductId?: string
  storeProductImg?: string
  storeProductName?: string
  storeSku?: string
  unitPrice?: number
  variantOptions?: string
  vid?: string
}

export interface CreateOrderPayload {
  consigneeID?: string
  email?: string
  fromCountryCode: string
  houseNumber?: string
  iossNumber?: string
  iossType?: 1 | 2 | 3
  logisticName: string
  orderNumber: string
  isSandbox?: 0 | 1
  /** 1 = CJ product flow (default), 2 = store order flow (store SKUs linked to CJ products) */
  orderFlow?: 1 | 2
  /** 1 = page payment (cjPayUrl is deprecated), 2 = balance payment, 3 = create order only */
  payType?: 1 | 2 | 3
  platform?: string
  podProperties?: {
    areaName: string
    layer?: unknown[]
    links: string[]
    type: string
  }[]
  products: OrderProduct[]
  remark?: string
  shippingAddress: string
  shippingAddress2?: string
  shippingCity: string
  shippingCountry: string
  shippingCountryCode: string
  shippingCounty?: string
  shippingCustomerName: string
  shippingPhone?: string
  shippingProvince: string
  shippingZip?: string
  shopAmount?: number
  /** 1 = platform logistics, 2 = merchant logistics (default), 3 = platform logistics with CJ-assigned warehouse */
  shopLogisticsType?: 1 | 2 | 3
  /** Required when shopLogisticsType is 1 */
  storageId?: string
  storeName?: string
  /** Seconds since epoch; must not be in the future */
  storeOrderTime?: number
  taxId?: string
}

interface ProductInfo {
  isGroup: boolean
  lineItemId: string
  quantity: number
  subOrderProducts: {
    lineItemId: string
    quantity: number
    variantId: string
  }[]
  variantId: string
}

// Define the order interception reasons structure
interface InterceptOrderReason {
  code: number
  message: string
}

export interface CreateOrderResponse {
  actualPayment?: number
  cjPayUrl?: string
  interceptOrderReasons: InterceptOrderReason[]
  iossAmount?: number
  iossTaxHandlingFee?: number
  logisticsMiss?: boolean
  orderAmount?: number
  orderId: string
  orderNumber: string
  orderOriginalAmount?: number
  orderStatus: string
  postageAmount?: number
  postageDiscountAmount?: number
  postageOriginalAmount?: number
  productAmount?: number
  productDiscountAmount?: number
  productInfoList: ProductInfo[]
  productOriginalAmount?: number
  shipmentOrderId: string
  totalDiscountAmount?: number
}

export interface Order {
  cjOrderId: null | string
  createDate: string
  logisticName?: string
  orderAmount?: number
  orderId: string
  orderNum: string
  orderStatus: string
  orderWeight: number
  paymentDate?: string
  postageAmount?: number
  productAmount: number
  productList?: any[] // You may replace `any` with a more specific type if known
  remark?: string
  shippingAddress: string
  shippingCity: string
  shippingCountryCode: string
  shippingCustomerName: string
  shippingPhone: string
  shippingProvince: string
  trackNumber?: string
}

export interface ListOrderResponse {
  list: Order[]
  pageNum: number
  pageSize: number
  total: number
}

export interface QueryOrderParams {
  /** LOGISTICS_TIMELINESS adds logisticTimelines to the response */
  features?: 'LOGISTICS_TIMELINESS'[]
  orderId?: string
  orderNum?: string
}

export interface ProductListEntry {
  quantity: number
  sellPrice: number
  vid: string
}

export interface QueryOrderResponse {
  cjOrderId: null | string
  createDate: string
  isComplete: number
  logisticName?: string
  orderAmount: number
  orderId: string
  orderNum: string
  orderStatus: string
  orderWeight: number
  paymentDate?: string
  platformOrderId?: null | string
  postageAmount: number
  productAmount: number
  productList: ProductListEntry[]
  remark?: string
  shippingAddress: string
  shippingCity: string
  shippingCountryCode: string
  shippingCustomerName: string
  shippingPhone: string
  shippingProvince: string
  trackNumber?: string
}
