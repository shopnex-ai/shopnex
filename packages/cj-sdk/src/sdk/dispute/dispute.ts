import type { APIResponse } from '../../error-types'
import type {
  CancelDisputeRequest,
  ConfirmDisputeRequest,
  ConfirmDisputeResponse,
  CreateDisputeRequest,
  DisputeAPIResponse,
  ListDisputesParams,
} from './dispute-types.ts'

import { cjApiClient } from '../../api-client'
import { getCurrentAccessToken } from '../access-token'

export async function createDispute(requestData: CreateDisputeRequest): Promise<APIResponse<DisputeAPIResponse>> {
  try {
    const accessToken = await getCurrentAccessToken() // Ensure to populate this with a valid token
    const response = await cjApiClient.post<DisputeAPIResponse>('disputes/create', requestData, {
      headers: {
        'CJ-Access-Token': accessToken,
      },
    })

    if (!response.data.result) {
      return {
        error: response.data.message || 'Failed to create dispute',
      }
    }

    return { data: response.data }
  } catch (error: any) {
    console.error(`Error creating dispute [${error.code}]: ${error.message}`)
    return { error: error.message || 'An unknown error occurred' }
  }
}

export async function confirmDispute(requestData: ConfirmDisputeRequest): Promise<APIResponse<ConfirmDisputeResponse>> {
  try {
    const accessToken = await getCurrentAccessToken() // Ensure to populate this with a valid token
    const response = await cjApiClient.post<ConfirmDisputeResponse>('disputes/disputeConfirmInfo', requestData, {
      headers: {
        'CJ-Access-Token': accessToken,
      },
    })

    if (!response.data.result) {
      return {
        error: response.data.message || 'Failed to confirm dispute',
      }
    }

    return { data: response.data }
  } catch (error: any) {
    console.error(`Error confirming dispute [${error.code}]: ${error.message}`)
    return { error: error.message || 'An unknown error occurred' }
  }
}

export async function getDisputeProducts(orderId: string): Promise<APIResponse<any>> {
  return disputeGet('disputes/disputeProducts', { orderId })
}

export async function cancelDispute(requestData: CancelDisputeRequest): Promise<APIResponse<any>> {
  try {
    const accessToken = await getCurrentAccessToken()
    const response = await cjApiClient.post<DisputeAPIResponse>('disputes/cancel', requestData, {
      headers: { 'CJ-Access-Token': accessToken },
    })

    if (!response.data.result) {
      return {
        error: response.data.message || 'Failed to cancel dispute',
      }
    }

    return { data: response.data.data }
  } catch (error: any) {
    console.error(`Error cancelling dispute [${error.code}]: ${error.message}`)
    return { error: error.message || 'An unknown error occurred' }
  }
}

export async function listDisputes(params: ListDisputesParams = {}): Promise<APIResponse<any>> {
  return disputeGet('disputes/getDisputeList', params)
}

export async function getDisputeDetail(disputeId: string): Promise<APIResponse<any>> {
  return disputeGet('disputes/getDisputeDetail', { disputeId })
}

async function disputeGet(path: string, params: object): Promise<APIResponse<any>> {
  try {
    const accessToken = await getCurrentAccessToken()
    const response = await cjApiClient.get<DisputeAPIResponse>(path, {
      headers: { 'CJ-Access-Token': accessToken },
      params,
    })

    if (!response.data.result) {
      return { error: response.data.message || `Request failed: ${path}` }
    }

    return { data: response.data.data }
  } catch (error: any) {
    console.error(`Error calling ${path} [${error.code}]: ${error.message}`)
    return { error: error.message || 'An unknown error occurred' }
  }
}
