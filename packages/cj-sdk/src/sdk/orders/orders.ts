import type { APIResponse } from '../../error-types'
import type { CJApiResponse } from '../../types'
import type {
  CreateOrderPayload,
  CreateOrderResponse,
  ListOrderResponse,
  QueryOrderParams,
  QueryOrderResponse,
} from './order-types.ts'

import { cjApiClient } from '../../api-client'
import { getCurrentAccessToken } from '../access-token'

interface ListOrderParams {
  orderIds?: string[]
  /** yyyy-MM-dd HH:mm:ss (UTC); must be sent together with paymentDateTo, max 90 days */
  paymentDateFrom?: string
  paymentDateTo?: string
  pageNum?: number
  pageSize?: number
  shipmentOrderId?: string
  /** CREATED, IN_CART, UNPAID, PENDING, PROCESSING, UNSHIPPED, SHIPPED, DELIVERED, CANCELLED, OTHER */
  status?: string
}

// accessToken defaults to the process-wide token from the environment (single-shop use)
export async function createOrder(
  orderData: CreateOrderPayload,
  options: { accessToken?: string; platformToken?: string } = {},
): Promise<APIResponse<CreateOrderResponse>> {
  try {
    const accessToken = options.accessToken ?? (await getCurrentAccessToken())
    const { platformToken } = options
    const response = await cjApiClient.post<CJApiResponse<CreateOrderResponse>>(
      'shopping/order/createOrderV2',
      orderData,
      {
        headers: {
          'CJ-Access-Token': accessToken,
          'Content-Type': 'application/json',
          ...(platformToken ? { platformToken } : {}),
        },
      },
    )

    if (!response.data.result) {
      return {
        error: response.data.message || 'Failed to create order',
      }
    }

    if (!response.data.data) {
      return { error: 'No order created' }
    }

    return { data: response.data.data }
  } catch (error: any) {
    console.error(`Error creating order [${error.code}]: ${error.message}`)
    return { error: error.message || 'An unknown error occurred' }
  }
}

export async function listOrders(
  accessToken: string,
  params: ListOrderParams = {},
): Promise<APIResponse<ListOrderResponse>> {
  try {
    const response = await cjApiClient.get<CJApiResponse<ListOrderResponse>>('shopping/order/list', {
      headers: {
        'CJ-Access-Token': accessToken,
      },
      params,
    })

    if (!response.data.result) {
      return {
        error: response.data.message || 'Failed to retrieve orders',
      }
    }

    if (!response.data.data) {
      return { error: 'No orders found' }
    }

    return { data: response.data.data }
  } catch (error: any) {
    console.error(`Error listing orders [${error.code}]: ${error.message}`)
    return { error: error.message || 'An unknown error occurred' }
  }
}

export async function queryOrder(
  params: QueryOrderParams,
  explicitToken?: string,
): Promise<APIResponse<QueryOrderResponse>> {
  if (!params.orderId && !params.orderNum) {
    return { error: 'Either orderId or orderNum must be provided.' }
  }

  try {
    const accessToken = explicitToken ?? (await getCurrentAccessToken())
    const response = await cjApiClient.get<CJApiResponse<QueryOrderResponse>>('shopping/order/getOrderDetail', {
      headers: {
        'CJ-Access-Token': accessToken,
      },
      params,
      // features=a&features=b, not features[]=a
      paramsSerializer: { indexes: null },
    })

    if (!response.data.result) {
      return {
        error: response.data.message || 'Failed to retrieve order details',
      }
    }

    if (!response.data.data) {
      return { error: 'No order details found' }
    }

    return { data: response.data.data }
  } catch (error: any) {
    console.error(`Error querying order [${error.code}]: ${error.message}`)
    return { error: error.message || 'An unknown error occurred' }
  }
}

export async function deleteOrder(orderId: string, explicitToken?: string): Promise<APIResponse<{ data: string }>> {
  if (!orderId) {
    return { error: 'orderId must be provided.' }
  }

  try {
    const accessToken = explicitToken ?? (await getCurrentAccessToken())
    const response = await cjApiClient.delete<CJApiResponse<{ data: string }>>('shopping/order/deleteOrder', {
      headers: {
        'CJ-Access-Token': accessToken,
      },
      params: { orderId },
    })

    if (!response.data.result) {
      return {
        error: response.data.message || 'Failed to delete order',
      }
    }

    if (!response.data.data) {
      return { error: 'Order deletion not confirmed, no data returned' }
    }

    return { data: response.data.data }
  } catch (error: any) {
    console.error(`Error deleting order [${error.code}]: ${error.message}`)
    return { error: error.message || 'An unknown error occurred' }
  }
}

export async function confirmOrder(orderId: string, explicitToken?: string): Promise<APIResponse<string>> {
  if (!orderId) {
    return { error: 'orderId must be provided.' }
  }

  try {
    const accessToken = explicitToken ?? (await getCurrentAccessToken())
    const response = await cjApiClient.patch<CJApiResponse<string>>(
      'shopping/order/confirmOrder',
      { orderId },
      {
        headers: {
          'CJ-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
      },
    )

    if (!response.data.result) {
      return {
        error: response.data.message || 'Failed to confirm order',
      }
    }

    if (!response.data.data) {
      return {
        error: 'Order confirmation not confirmed, no data returned',
      }
    }

    return { data: response.data.data }
  } catch (error: any) {
    console.error(`Error confirming order [${error.code}]: ${error.message}`)
    return { error: error.message || 'An unknown error occurred' }
  }
}
