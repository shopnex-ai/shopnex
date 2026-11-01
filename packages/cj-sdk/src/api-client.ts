import axios, { type AxiosError, type AxiosInstance, type AxiosResponse } from 'axios'

import { handleCJError } from './error-handler'

export const cjApiClient: AxiosInstance = axios.create({
  baseURL: 'https://developers.cjdropshipping.com/api2.0/v1/',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 20000,
})

// CJ allows one call per second per account (error 1600200). Calls with the same access token are spaced out
// here, so callers can fire several in a row; auth calls (no token yet) share one lane.
// CJ counts on its side, so a gap of exactly one second is not always enough
const MIN_GAP_MS = 1500
const nextFreeAt = new Map<string, number>()
const RATE_LIMITED = 1600200
type Retried = { _retried?: boolean }

cjApiClient.interceptors.request.use(async (config) => {
  const lane = String(config.headers.get('CJ-Access-Token') ?? 'anonymous')
  const now = Date.now()
  // Reserve the slot before waiting, so concurrent calls queue behind each other
  const at = Math.max(now, nextFreeAt.get(lane) ?? 0)
  nextFreeAt.set(lane, at + MIN_GAP_MS)
  if (nextFreeAt.size > 100) {
    for (const [key, time] of nextFreeAt) {
      if (time < now) nextFreeAt.delete(key)
    }
  }
  if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now))
  return config
})

// Response interceptor for automatic error handling
cjApiClient.interceptors.response.use(
  async (response: AxiosResponse) => {
    if (response.data.code === RATE_LIMITED && !(response.config as Retried)._retried) {
      // Went through the lane above and was still refused: try once more, queued behind the others
      ;(response.config as Retried)._retried = true
      return cjApiClient.request(response.config)
    }
    if (response.data.code !== 200) {
      handleCJError(response.data)
    }
    return response
  },
  (error: AxiosError) => {
    const config = error.config as (Retried & typeof error.config) | undefined
    if (config && !config._retried && (error.response?.data as { code?: number } | undefined)?.code === RATE_LIMITED) {
      config._retried = true
      return cjApiClient.request(config)
    }
    if (error.response) {
      // Handle CJ API errors
      handleCJError(error.response.data as { code: number; message?: string })
    } else if (error.request) {
      throw new Error('Network error: No response from CJ API')
    } else {
      throw new Error(`Axios error: ${error.message}`)
    }
  },
)
