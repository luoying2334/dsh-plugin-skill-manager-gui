/**
 * Minimal HTTP helpers shared by every skill-manager route: JSON
 * serialization, same-origin enforcement, loopback enforcement for mutating
 * endpoints, and a size-capped JSON body reader.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/** Write a JSON payload with no-store caching. */
export function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

/** True when the request's Origin matches its Host — required on every POST route. */
export function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  const host = request.headers.host
  if (origin === undefined || host === undefined) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** True when the socket peer is a loopback address. */
export function isLoopback(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/**
 * Enforce the mutating-request boundary: same-origin browser plus a loopback
 * peer. The web server binds 127.0.0.1 by default, but `--trusted-host` may
 * admit LAN clients; skill files are written with the host user's
 * permissions, so mutation is loopback-pinned like the harness's own
 * privileged operations.
 */
export function assertLocalMutation(request: IncomingMessage): string | null {
  if (!sameOrigin(request)) return 'cross-origin request rejected'
  if (!isLoopback(request)) return 'non-loopback request rejected'
  return null
}

/** Read and parse a JSON request body, rejecting anything over the cap. */
export async function readJsonBody(request: IncomingMessage, maxBytes = 256 * 1024): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw new Error('request body too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}
