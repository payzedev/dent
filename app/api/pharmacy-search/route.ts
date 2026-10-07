import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

type PharmacyResult = {
  pharmacy: 'Farmaciasaas' | 'Farmatodo'
  productUrl: string
  name: string | null
  description: string | null
  imageUrl: string | null
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
}

function readMeta(html: string, key: string) {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? []
  for (const tag of tags) {
    const attrs = new Map<string, string>()
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attrs.set(match[1].toLowerCase(), decodeHtml(match[2] ?? match[3] ?? match[4] ?? ''))
    }
    if (attrs.get('property')?.toLowerCase() === key || attrs.get('name')?.toLowerCase() === key) {
      return attrs.get('content')?.trim() || null
    }
  }
  return null
}

function readJsonLd(html: string) {
  const scripts = html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  for (const script of scripts) {
    try {
      const value: unknown = JSON.parse(script[1].replace(/&quot;/g, '"'))
      const pending: unknown[] = Array.isArray(value) ? [...value] : [value]
      while (pending.length) {
        const current = pending.shift()
        if (!current || typeof current !== 'object') continue
        if (Array.isArray(current)) {
          pending.push(...current)
          continue
        }
        const record = current as Record<string, unknown>
        const type = record['@type']
        if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) return record
        if (record['@graph']) pending.push(record['@graph'])
      }
    } catch {
      continue
    }
  }
  return null
}

function absoluteImageUrl(value: unknown, baseUrl: string) {
  const candidate = typeof value === 'string' ? value : Array.isArray(value) ? value.find((entry) => typeof entry === 'string') : null
  if (typeof candidate !== 'string') return null
  try {
    const url = new URL(candidate, baseUrl)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

async function searchPharmacy(pharmacy: PharmacyResult['pharmacy'], productUrl: string): Promise<PharmacyResult> {
  const response = await fetch(productUrl, {
    headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'Mozilla/5.0 DentaStock product lookup' },
    signal: AbortSignal.timeout(12_000),
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`${pharmacy} responded with status ${response.status}`)

  const html = await response.text()
  const jsonLd = readJsonLd(html)
  const jsonName = typeof jsonLd?.name === 'string' ? jsonLd.name : null
  const jsonDescription = typeof jsonLd?.description === 'string' ? jsonLd.description : null
  return {
    pharmacy,
    productUrl,
    name: jsonName || readMeta(html, 'og:title') || readMeta(html, 'twitter:title'),
    description: jsonDescription || readMeta(html, 'og:description') || readMeta(html, 'description'),
    imageUrl: absoluteImageUrl(jsonLd?.image, productUrl) || absoluteImageUrl(readMeta(html, 'og:image'), productUrl),
  }
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Sign in to search pharmacy catalogs.' }, { status: 401 })

  const barcode = new URL(request.url).searchParams.get('barcode')?.trim() ?? ''
  if (!/^[\da-zA-Z-]{1,128}$/.test(barcode)) {
    return NextResponse.json({ error: 'Enter a valid product barcode.' }, { status: 400 })
  }

  const farmaciasaasUrl = new URL(`https://www.farmaciasaas.com/${encodeURIComponent(barcode)}`)
  farmaciasaasUrl.searchParams.set('_q', barcode)
  farmaciasaasUrl.searchParams.set('map', 'ft')
  const farmatodoUrl = new URL('https://www.farmatodo.com.ve/buscar')
  farmatodoUrl.searchParams.set('product', barcode)
  farmatodoUrl.searchParams.set('departamento', 'Todos')
  farmatodoUrl.searchParams.set('filtros', '')

  const pharmacies = await Promise.allSettled([
    searchPharmacy('Farmaciasaas', farmaciasaasUrl.toString()),
    searchPharmacy('Farmatodo', farmatodoUrl.toString()),
  ])
  const results: PharmacyResult[] = []
  const failures: string[] = []
  for (const [index, result] of pharmacies.entries()) {
    if (result.status === 'fulfilled') results.push(result.value)
    else {
      const pharmacy = index === 0 ? 'Farmaciasaas' : 'Farmatodo'
      const productUrl = index === 0 ? farmaciasaasUrl.toString() : farmatodoUrl.toString()
      console.error(`${pharmacy} product search failed`, result.reason instanceof Error ? result.reason.message : 'Unknown error')
      failures.push(pharmacy)
      results.push({ pharmacy, productUrl, name: null, description: null, imageUrl: null })
    }
  }
  return NextResponse.json({ results, failedPharmacies: failures })
}
