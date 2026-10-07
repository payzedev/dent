import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const maxImageBytes = 5 * 1024 * 1024

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Sign in to load product images.' }, { status: 401 })

  const params = new URL(request.url).searchParams
  const path = params.get('path')?.trim() ?? ''
  if (params.get('user') !== user.id || !path || path.startsWith('/') || path.includes('..')) {
    return NextResponse.json({ error: 'Invalid product image request.' }, { status: 400 })
  }

  const { data: signed, error: signError } = await supabase.storage
    .from('inventory-images').createSignedUrl(path, 300)
  if (signError) {
    console.error('Could not authorize product image', signError.message)
    return NextResponse.json({ error: 'The product image is unavailable.' }, { status: 404 })
  }
  let response: Response
  try {
    response = await fetch(signed.signedUrl, {
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    })
  } catch (error) {
    console.error('Could not load product image from storage', error instanceof Error ? error.message : 'Unknown network error')
    return NextResponse.json({ error: 'The product image could not be loaded.' }, { status: 502 })
  }
  if (!response.ok) {
    console.error('Could not load product image from storage', response.status)
    return NextResponse.json({ error: 'The product image could not be loaded.' }, { status: 502 })
  }

  const contentType = response.headers.get('content-type')?.split(';')[0].toLowerCase() ?? ''
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
    return NextResponse.json({ error: 'The stored file is not a supported image.' }, { status: 415 })
  }
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (contentLength > maxImageBytes) {
    return NextResponse.json({ error: 'The product image exceeds the 5 MB limit.' }, { status: 413 })
  }
  if (!response.body) return NextResponse.json({ error: 'The product image response was empty.' }, { status: 502 })

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxImageBytes) {
        await reader.cancel()
        return NextResponse.json({ error: 'The product image exceeds the 5 MB limit.' }, { status: 413 })
      }
      chunks.push(value)
    }
  } catch (error) {
    console.error('Could not read product image from storage', error instanceof Error ? error.message : 'Unknown stream error')
    return NextResponse.json({ error: 'The product image could not be read.' }, { status: 502 })
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
      'Cache-Control': 'private, max-age=3600, stale-while-revalidate=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
