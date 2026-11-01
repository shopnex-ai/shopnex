import type { APIResponse } from '../../error-types'
import type {
  CategoryAttribute,
  CategoryCertification,
  CjShop,
  ListingShopInfo,
  PlatformBrand,
  PlatformCategory,
  PublishParams,
  PublishStatus,
} from './listing-types.ts'

import { cjApiClient } from '../../api-client'

// Listing endpoints answer { success, code, data } (the shop list answers { result, code, data }); a code other
// than 200 is thrown by the client, so here the data is whatever came back. Each /listed call costs the account
// 10 API points, failed ones too.
async function call<T>(
  method: 'get' | 'post',
  path: string,
  accessToken: string,
  body: object | undefined,
  what: string,
): Promise<APIResponse<T>> {
  try {
    const headers = { 'CJ-Access-Token': accessToken }
    const response =
      method === 'get'
        ? await cjApiClient.get<{ data: T | null }>(path, { headers })
        : await cjApiClient.post<{ data: T | null }>(path, body, { headers })
    return { data: response.data.data as T }
  } catch (error: any) {
    console.error(`Error ${what} [${error.code}]: ${error.message}`)
    return { error: error.message || `Failed ${what}` }
  }
}

export const getShops = (accessToken: string) =>
  call<CjShop[]>('get', 'shop/getShops', accessToken, undefined, 'fetching stores')

export const getListingShopInfo = (accessToken: string, shopId: string) =>
  call<ListingShopInfo[]>('post', 'listed/queryShopInfo', accessToken, { shopId }, 'fetching store info')

export const getChildCategories = (
  accessToken: string,
  params: { shopId: string; parentCategoryId: string; cjProductId?: string; title?: string },
) => call<PlatformCategory[]>('post', 'listed/getChildCategoryList', accessToken, params, 'fetching categories')

export const getCategoryAttributes = (
  accessToken: string,
  params: { shopId: string; categoryId: string; productId: string },
) => call<CategoryAttribute[]>('post', 'listed/getCategorySpecificsList', accessToken, params, 'fetching attributes')

export const getCategoryCertifications = (
  accessToken: string,
  params: { shopId: string; categoryId: string; productId: string },
) =>
  call<CategoryCertification[]>(
    'post',
    'listed/getProductCertifications',
    accessToken,
    params,
    'fetching certifications',
  )

export const getBrands = (accessToken: string, params: { shopId: string; categoryId?: string; pageSize?: number }) =>
  call<PlatformBrand[]>(
    'post',
    'listed/queryBrand',
    accessToken,
    { needNoBrand: true, pageNum: 1, pageSize: 50, ...params },
    'fetching brands',
  )

/** Starts the listing; CJ answers with the listing record id and finishes in the background */
export const publishAsync = (accessToken: string, params: PublishParams) =>
  call<string>('post', 'listed/publishAsync', accessToken, params, 'listing the product')

/**
 * The state of one listing record. The record id is sent as a string: CJ's ids are too big for a JS number, so
 * the id in the response can't be trusted and isn't read.
 */
export const queryPublishStatus = (accessToken: string, listedId: string) =>
  call<PublishStatus | null>('post', 'listed/queryPublishStatus', accessToken, { listedId }, 'fetching listing status')

/** Submits a failed listing again with its original parameters */
export const republish = (accessToken: string, shopId: string, listedProductId: string) =>
  call<boolean>('post', 'listed/republish', accessToken, { shopId, listedProductId }, 'listing the product again')
