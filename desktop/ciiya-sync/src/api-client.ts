import type {
  CiiyaSyncDesktopAlbum,
  CiiyaSyncDesktopPlatform,
} from './contracts'

type ApiErrorResponse = {
  error?: string
  code?: string
}

export type CiiyaSyncPairingStart = {
  pairingId: string
  userCode: string
  pollSecret: string
  verificationUriComplete: string
  expiresAt: string
  interval: number
}

export type CiiyaSyncPairingResult = {
  paired: boolean
  status: string
  deviceId?: string
  ownerId?: string
  deviceToken?: string
  expiresAt?: string
}

export class CiiyaSyncDesktopApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'CiiyaSyncDesktopApiError'
  }
}

export class CiiyaSyncDesktopApi {
  private fetchImplementation: typeof fetch

  constructor(
    readonly baseUrl: string,
    fetchImplementation?: typeof fetch
  ) {
    const parsed = new URL(baseUrl)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Ciiya API URL must use HTTP or HTTPS')
    }
    this.baseUrl = parsed.toString().replace(/\/$/, '')
    this.fetchImplementation = fetchImplementation || fetch
  }

  async startPairing(input: {
    clientDeviceId: string
    deviceName: string
    platform: CiiyaSyncDesktopPlatform
    appVersion: string
  }) {
    const response = await this.request('/api/ciiya-sync/pairing/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const data = (await response.json()) as CiiyaSyncPairingStart & ApiErrorResponse
    if (!response.ok) throw this.apiError(response, data)
    if (
      !data.pairingId ||
      !data.userCode ||
      !data.pollSecret ||
      !data.verificationUriComplete ||
      !data.expiresAt
    ) {
      throw new CiiyaSyncDesktopApiError(
        'Invalid pairing response',
        'INVALID_PAIRING_RESPONSE',
        502
      )
    }
    return data
  }

  async pairingStatus(
    input: { pairingId: string; pollSecret: string },
    signal?: AbortSignal
  ) {
    const response = await this.request(
      '/api/ciiya-sync/pairing/status',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
      signal
    )
    const data = (await response.json()) as CiiyaSyncPairingResult & ApiErrorResponse
    if (response.status === 202) return data
    if (!response.ok) throw this.apiError(response, data)
    return data
  }

  async albums(deviceToken: string, signal?: AbortSignal) {
    const response = await this.request(
      '/api/ciiya-sync/albums',
      {
        headers: { Authorization: `Bearer ${deviceToken}` },
      },
      signal
    )
    const data = (await response.json()) as {
      albums?: Array<Record<string, unknown>>
    } & ApiErrorResponse
    if (!response.ok) throw this.apiError(response, data)

    return (data.albums || []).map(
      (album): CiiyaSyncDesktopAlbum => ({
        id: String(album.id || ''),
        title: String(album.title || 'Untitled album'),
        description:
          typeof album.description === 'string' ? album.description : null,
        coverUrl: typeof album.cover_url === 'string' ? album.cover_url : null,
        status: typeof album.status === 'string' ? album.status : null,
        photoCount: Number(album.photo_count || 0),
        updatedAt:
          typeof album.updated_at === 'string' ? album.updated_at : null,
      })
    )
  }

  private async request(
    pathname: string,
    init: RequestInit,
    signal?: AbortSignal
  ) {
    const timeout = AbortSignal.timeout(30_000)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    try {
      return await this.fetchImplementation(`${this.baseUrl}${pathname}`, {
        ...init,
        signal: combined,
      })
    } catch (error) {
      if (signal?.aborted) throw error
      throw new CiiyaSyncDesktopApiError(
        error instanceof Error ? error.message : 'Network unavailable',
        'NETWORK_UNAVAILABLE',
        0
      )
    }
  }

  private apiError(response: Response, data: ApiErrorResponse) {
    return new CiiyaSyncDesktopApiError(
      data.error || `Ciiya request failed (${response.status})`,
      data.code || `HTTP_${response.status}`,
      response.status
    )
  }
}
