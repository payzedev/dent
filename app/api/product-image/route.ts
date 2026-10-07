import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const trustedImageHosts = [
  'amazon.com',
  'ssl-images-amazon.com',
  'media-amazon.com',
  'aliexpress.com',
  'alicdn.com',
  'aliexpress-media.com',
  'alibaba.com',
  'bluedentalvzla.com',
  'dymstudents.com',
  'dentaltix.com',
  'farmaciasaas.com',
  'farmatodo.com.ve',
  'farmaexpress.com',
  'farmago.com.ve',
  'tuzonamarket.com',
  'farmabien.com',
  'vtexassets.com',
]
const maxImageBytes = 5 * 1024 * 1024

function isTrustedHost(hostname: string) {
  const host = hostname.toLowerCase()
  return trustedImageHosts.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Sign in to load product images.' }, { status: 401 })

  const rawUrl = new URL(request.url).searchParams.get('url')
  if (!rawUrl) return NextResponse.json({ error: 'A product image URL is required.' }, { status: 400 })
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return NextResponse.json({ error: 'Invalid product image URL.' }, { status: 400 })
  }
  if (url.protocol !== 'https:' || !isTrustedHost(url.hostname)) {
    return NextResponse.json({ error: 'Product image host is not allowed.' }, { status: 400 })
  }

  let response: Response | null = null
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    response = await fetch(url, {
      headers: { Accept: 'image/jpeg,image/png,image/webp', 'User-Agent': 'Mozilla/5.0 DentaStock product image' },
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    })
    if (![301, 302, 303, 307, 308].includes(response.status)) break
    const location = response.headers.get('location')
    if (!location || redirect === 3) {
      return NextResponse.json({ error: 'Product image redirect limit exceeded.' }, { status: 502 })
    }
    url = new URL(location, url)
    if (url.protocol !== 'https:' || !isTrustedHost(url.hostname)) {
      return NextResponse.json({ error: 'Product image redirected to an untrusted host.' }, { status: 502 })
    }
  }

  if (!response?.ok) return NextResponse.json({ error: 'The product image could not be downloaded.' }, { status: 502 })
  const contentType = response.headers.get('content-type')?.split(';')[0].toLowerCase() ?? ''
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
    return NextResponse.json({ error: 'The selected URL is not a supported product image.' }, { status: 415 })
  }
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (contentLength > maxImageBytes) return NextResponse.json({ error: 'Product image exceeds the 5 MB limit.' }, { status: 413 })
  if (!response.body) return NextResponse.json({ error: 'The product image response was empty.' }, { status: 502 })
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > maxImageBytes) {
      await reader.cancel()
      return NextResponse.json({ error: 'Product image exceeds the 5 MB limit.' }, { status: 413 })
    }
    chunks.push(value)
  }
  const image = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    image.set(chunk, offset)
    offset += chunk.byteLength
  }

  return new NextResponse(image, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
