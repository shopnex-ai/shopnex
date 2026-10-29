// disputes-types.ts
export interface CreateDisputeRequest {
  businessDisputeId: string
  disputeReasonId: number
  expectType: number
  imageUrl?: string[]
  messageText: string
  orderId: string
  productInfoList: {
    lineItemId: string
    price?: number // If necessary
    quantity: number
  }[]
  refundType: number
  videoUrl?: string[]
}

export interface DisputeAPIResponse {
  code: number
  data: any // Adjust based on the actual structure
  message: string
  redirectUri?: string
  requestId?: string
  result: boolean
}

// dispute-types.ts
export interface ConfirmDisputeRequest {
  orderId: string
  productInfoList: {
    lineItemId: string
    price?: number // If necessary
    quantity: number
  }[]
}

export interface ConfirmDisputeResponse {
  code: number
  data: {
    disputeReasonList: {
      disputeReasonId: number
      reasonName: string
    }[]
    expectResultOptionList: string[]
    maxAmount: number
    maxIossHandTaxAmount: number
    maxIossTaxAmount: number
    maxPostage: number
    maxProductPrice: number
    orderId: string
    orderNumber: string
    productInfoList: {
      canChoose: boolean
      cjImage: string
      cjProductId: string
      cjProductName: string
      cjVariantId: string
      lineItemId: string
      price: number
      quantity: number
      sku: string
      supplierName: string
    }[]
  }
  message: string
  requestId: string
  result: boolean
  success: boolean
}

export interface CancelDisputeRequest {
  disputeId: string
  orderId: string
}

export interface ListDisputesParams {
  /** UTC milliseconds, exclusive; pair with startDate, max 90 days */
  endDate?: number
  disputeId?: number
  orderId?: string
  orderNumber?: string
  pageNum?: number
  pageSize?: number
  startDate?: number
  /** Comma-separated V2 codes: 100 pending, 200 review, 300 finance review, 400 on hold, 500 customer confirmation, 510 supplier refund review, 520 awaiting payment, 530 payment processing, 540 arbitration reserved, 600 completed, 700 cancelled, 800 arbitration cancelled */
  status?: string
  /** UTC milliseconds, inclusive; pair with updateDateTo, max 31 days */
  updateDateFrom?: number
  updateDateTo?: number
}
