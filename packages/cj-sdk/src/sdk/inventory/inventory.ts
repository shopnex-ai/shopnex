import type { APIResponse } from '../../error-types'
import type { CJApiResponse } from '../../types'
import type { Inventory } from './inventory-types.ts'

import { cjApiClient } from '../../api-client'
import { getCurrentAccessToken } from '../access-token'

export async function getInventoryByVariantId(vid: string): Promise<APIResponse<Inventory[]>> {
  if (!vid) {
    return { error: 'vid must be provided.' }
  }

  try {
    const accessToken = await getCurrentAccessToken() // Ensure you populate this with a valid token
    const response = await cjApiClient.get<CJApiResponse<Inventory[]>>('product/stock/queryByVid', {
      headers: {
        'CJ-Access-Token': accessToken,
      },
      params: { vid },
    })

    if (!response.data.result) {
      return {
        error: response.data.message || 'Failed to fetch inventory',
      }
    }

    if (!response.data.data) {
      return { error: 'No inventory found' }
    }

    return { data: response.data.data }
  } catch (error: any) {
    console.error(`Error fetching inventory by variant ID [${error.code}]: ${error.message}`)
    return { error: error.message || 'An unknown error occurred' }
  }
}
