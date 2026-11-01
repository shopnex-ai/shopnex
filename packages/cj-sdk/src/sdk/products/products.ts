import type { APIResponse } from '../../error-types'
import type {
  CategoryFirstLevel,
  CategoryListResponse,
  MyProductsParams,
  Product,
  ProductDetails,
  ProductInventory,
  ProductListResponse,
  ProductListV2Data,
  ProductListV2Params,
  ShopProductsParams,
  StockInfo,
} from './product-types.ts'

import { cjApiClient } from '../../api-client'
import { getCurrentAccessToken } from '../access-token'

export async function getProductCategory(accessToken: string, params: any): Promise<APIResponse<CategoryFirstLevel[]>> {
  try {
    const response = await cjApiClient.get<CategoryListResponse>('/product/getCategory', {
      headers: { 'CJ-Access-Token': accessToken },
      params,
    })

    const data = response.data.data
    if (!data) {
      return { error: 'No categories found' }
    }

    return { data }
  } catch (error: any) {
    console.error(`Error fetching categories [${error.code}]: ${error.message}`)
    return { error: error.message || 'Failed to fetch categories' }
  }
}

export async function getProductList(params: Record<string, any> = {}): Promise<APIResponse<Product[]>> {
  const defaultParams = {
    pageNum: 1,
    pageSize: 20,
  }
  const query = { ...defaultParams, ...params }

  try {
    const accessToken = await getCurrentAccessToken()
    const response = await cjApiClient.get<ProductListResponse>(
      'https://developers.cjdropshipping.com/api2.0/v1/product/list',
      {
        headers: {
          'CJ-Access-Token': accessToken,
        },
        params: query,
      },
    )

    const data = response.data

    if (!data.result) {
      return { error: data.message || 'Failed to fetch product list' }
    }

    if (!data.data?.list) {
      return { error: 'No products found' }
    }

    return { data: data.data.list }
  } catch (error: any) {
    console.error(`Error fetching product list [${error.code}]: ${error.message}`)
    return { error: error.message || 'Failed to fetch product list' }
  }
}

export async function getProductDetails(queryParams: {
  accessToken: string
  pid?: string
  productSku?: string
  variantSku?: string
}): Promise<APIResponse<ProductDetails>> {
  const { accessToken, pid, productSku, variantSku } = queryParams
  if (!pid && !productSku && !variantSku) {
    return {
      error: 'One of pid, productSku, or variantSku must be provided.',
    }
  }

  try {
    const response = await cjApiClient.get<{
      code: number
      data: ProductDetails
      message: string
      result: boolean
    }>('https://developers.cjdropshipping.com/api2.0/v1/product/query', {
      headers: {
        'CJ-Access-Token': accessToken,
      },
      params: queryParams,
    })

    if (!response.data.result) {
      return {
        error: response.data.message || 'Failed to fetch product details',
      }
    }

    return { data: response.data.data }
  } catch (error: any) {
    console.error(`Error fetching product details [${error.code}]: ${error.message}`)
    // Keep CJ's code so callers can tell "removed from shelves" (1602002) from a failure
    throw Object.assign(new Error(error.message), { code: error.code })
  }
}

// The stock endpoints reply {success: true, code: 200} without `result`, so only an explicit `result: false` is a
// failure here (the client already throws on any code other than 200).
export async function getProductStockByVid({
  accessToken,
  vid,
}: {
  accessToken: string
  vid: string
}): Promise<APIResponse<StockInfo[]>> {
  try {
    const response = await cjApiClient.get<{
      code: number
      data: StockInfo[]
      message: string
      result: boolean
    }>('/product/stock/queryByVid', {
      headers: {
        'CJ-Access-Token': accessToken,
      },
      params: { vid },
    })

    if (response.data.result === false) {
      return {
        error: response.data.message || 'Failed to fetch stock information',
      }
    }

    return { data: response.data.data }
  } catch (error: any) {
    console.error(`Error fetching stock by VID [${error.code}]: ${error.message}`)
    return { error: error.message || 'Failed to fetch stock information' }
  }
}

export async function getProductStockBySku(sku: string, accessToken: string): Promise<APIResponse<StockInfo[]>> {
  try {
    const response = await cjApiClient.get<{
      code: number
      data: StockInfo[]
      message: string
      result: boolean
    }>('/product/stock/queryBySku', {
      headers: {
        'CJ-Access-Token': accessToken,
      },
      params: { sku },
    })

    if (response.data.result === false) {
      return {
        error: response.data.message || 'Failed to fetch stock information',
      }
    }

    return { data: response.data.data }
  } catch (error: any) {
    console.error(`Error fetching stock by SKU [${error.code}]: ${error.message}`)
    return { error: error.message || 'Failed to fetch stock information' }
  }
}

export async function getProductListV2(
  accessToken: string,
  params: ProductListV2Params = {},
): Promise<APIResponse<ProductListV2Data>> {
  try {
    const response = await cjApiClient.get<{
      code: number
      data: ProductListV2Data
      message: string
      result: boolean
    }>('/product/listV2', {
      headers: { 'CJ-Access-Token': accessToken },
      params,
      // lv2categoryList=a&lv2categoryList=b, features=x&features=y
      paramsSerializer: { indexes: null },
    })

    if (!response.data.result) {
      return {
        error: response.data.message || 'Failed to fetch products',
      }
    }

    return { data: response.data.data }
  } catch (error: any) {
    console.error(`Error fetching product list V2 [${error.code}]: ${error.message}`)
    return { error: error.message || 'Failed to fetch products' }
  }
}

export async function getProductInventoryByPid(
  accessToken: string,
  pid: string,
): Promise<APIResponse<ProductInventory>> {
  try {
    const response = await cjApiClient.get<{
      code: number
      data: ProductInventory
      message: string
      result: boolean
    }>('/product/stock/getInventoryByPid', {
      headers: { 'CJ-Access-Token': accessToken },
      params: { pid },
    })

    if (response.data.result === false) {
      return {
        error: response.data.message || 'Failed to fetch stock information',
      }
    }

    return { data: response.data.data }
  } catch (error: any) {
    console.error(`Error fetching stock by PID [${error.code}]: ${error.message}`)
    return { error: error.message || 'Failed to fetch stock information' }
  }
}

// The merchant's "My Products" in CJ. The saved docs don't describe the response items, so they stay loose.
export async function getMyProducts(accessToken: string, params: MyProductsParams = {}): Promise<APIResponse<any>> {
  return getData('/product/myProduct/query', accessToken, params)
}

export async function addToMyProducts(accessToken: string, productId: string): Promise<APIResponse<boolean>> {
  try {
    const response = await cjApiClient.post<{
      data: boolean
      message: string
      result: boolean
    }>('/product/addToMyProduct', { productId }, { headers: { 'CJ-Access-Token': accessToken } })

    if (!response.data.result) {
      return {
        error: response.data.message || 'Failed to add to My Products',
      }
    }

    return { data: response.data.data }
  } catch (error: any) {
    console.error(`Error adding to My Products [${error.code}]: ${error.message}`)
    return { error: error.message || 'Failed to add to My Products' }
  }
}

// Products on the merchant's connected stores (no variants; use the detail call for those)
export async function getShopProducts(accessToken: string, params: ShopProductsParams = {}): Promise<APIResponse<any>> {
  return getData('/shop/product/queryPage', accessToken, params)
}

export async function getShopProductDetail(accessToken: string, shopProductId: string): Promise<APIResponse<any>> {
  return getData('/shop/product/queryDetail', accessToken, {
    shopProductId,
  })
}

async function getData(path: string, accessToken: string, params: object): Promise<APIResponse<any>> {
  try {
    const response = await cjApiClient.get<{
      data: unknown
      message: string
      result: boolean
    }>(path, {
      headers: { 'CJ-Access-Token': accessToken },
      params,
      // relevanceStatusValues=0&relevanceStatusValues=1
      paramsSerializer: { indexes: null },
    })

    if (!response.data.result) {
      return { error: response.data.message || `Request failed: ${path}` }
    }

    return { data: response.data.data }
  } catch (error: any) {
    console.error(`Error calling ${path} [${error.code}]: ${error.message}`)
    return { error: error.message || `Request failed: ${path}` }
  }
}
