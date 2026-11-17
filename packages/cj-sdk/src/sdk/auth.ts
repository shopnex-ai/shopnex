import type { AccessTokenResponse } from '../types'

import { cjApiClient } from '../api-client'
import { log } from '../log'

interface RefreshTokenResponse {
  code: number
  data: {
    accessToken: string
    accessTokenExpiryDate: string
    createDate: string
    refreshToken: string
    refreshTokenExpiryDate: string
  }
  message: string
  requestId: string
  result: boolean
}

interface LogoutResponse {
  code: number
  data: boolean
  message: string
  requestId: string
  result: boolean
}

export async function getAccessToken(apiKey: string) {
  try {
    const response = await cjApiClient.post<AccessTokenResponse>('authentication/getAccessToken', { apiKey })

    if (!response.data.data?.accessToken) {
      throw new Error('Failed to fetch access token')
    }
    // TODO: add logger
    return response.data.data
  } catch (error) {
    log.error({ err: error }, 'Error fetching access token')
    throw error // Rethrow for caller to handle
  }
}

export async function refreshAccessToken(refreshToken: string) {
  try {
    const response = await cjApiClient.post<RefreshTokenResponse>('authentication/refreshAccessToken', {
      refreshToken,
    })

    // TODO: add logger
    return response.data.data
  } catch (error) {
    log.error({ err: error }, 'Error refreshing access token')
    throw error
  }
}

export async function logout(accessToken: string) {
  try {
    await cjApiClient.post<LogoutResponse>(
      'authentication/logout',
      {},
      {
        headers: { 'CJ-Access-Token': accessToken },
      },
    )

    log.info('Successfully logged out')
  } catch (error) {
    log.error({ err: error }, 'Logout failed')
    throw error
  }
}
