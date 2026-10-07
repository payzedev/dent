import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

type PharmacyResult = {
  pharmacy: 'Farmaciasaas' | 'Farmatodo'
  productUrl: string
  found: boolean
  name: string | null
  description: string | null
  imageUrl: string | null
  brand?: string | null
}

type StoreProduct = {
  productName?: string
  name?: string
  description?: string
  link?: string
  linkText?: string
  brand?: string
  items?: Array<{
    ean?: string
    referenceId?: Array<{ Value?: string }>
    images?: Array<{ imageUrl?: string }>
  }>
}

function readJsonLd(html: string, barcode: string) {
  const scripts = html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  for (const script of scripts) {
    try {
      const value: unknown = JSON.parse(script[1])
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
        const isProduct = type === 'Product' || (Array.isArray(type) && type.includes('Product'))
        const identifiers = [record.gtin, record.gtin8, record.gtin12, record.gtin13, record.gtin14, record.sku]
        const matchingOffer = record.offers && typeof record.offers === 'object' && !Array.isArray(record.offers)
          ? (record.offers as Record<string, unknown>)
          : null
        if (isProduct && [...identifiers, matchingOffer?.gtin, matchingOffer?.sku].some((value) => String(value ?? '') === barcode)) return record
        if (record['@graph']) pending.push(record['@graph'])
      }
    } catch {
      continue
    }
  }
  return null
}

function findStoreProduct(value: unknown, barcode: string): StoreProduct | null {
  if (!Array.isArray(value)) return null
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const product = entry as StoreProduct
    if (product.items?.some((item) => item.ean?.trim() === barcode)) return product
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

async function searchPharmacy(
  pharmacy: PharmacyResult['pharmacy'],
  barcode: string,
  searchUrl: string,
): Promise<PharmacyResult> {
  const origin = new URL(searchUrl).origin
  const apiUrls = [
    `${origin}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(barcode)}&_from=0&_to=9`,
    `${origin}/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${encodeURIComponent(barcode)}&_from=0&_to=9`,
  ]
  for (const apiUrl of apiUrls) {
    try {
      const response = await fetch(apiUrl, {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 DentaStock product lookup' },
        signal: AbortSignal.timeout(8_000),
        cache: 'no-store',
      })
      if (!response.ok) continue
      const products: unknown = await response.json()
      const match = findStoreProduct(products, barcode)
      if (!match) continue
      const item = match.items?.find((entry) => entry.ean?.trim() === barcode)
      const productUrl = match.link
        ? new URL(match.link, origin).toString()
        : new URL(match.linkText ?? '', origin).toString()
      return {
        pharmacy,
        productUrl,
        found: true,
        name: match.productName || match.name || null,
        description: match.description || null,
        imageUrl: absoluteImageUrl(item?.images?.[0]?.imageUrl, origin),
        brand: match.brand || null,
      }
    } catch (error) {
      console.error(`${pharmacy} product API request failed`, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  const response = await fetch(searchUrl, {
    headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'Mozilla/5.0 DentaStock product lookup' },
    signal: AbortSignal.timeout(8_000),
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`${pharmacy} responded with status ${response.status}`)
  const html = await response.text()
  const jsonLd = readJsonLd(html, barcode)
  if (jsonLd) {
    const image = jsonLd.image
    return {
      pharmacy,
      productUrl: typeof jsonLd.url === 'string' ? new URL(jsonLd.url, origin).toString() : searchUrl,
      found: true,
      name: typeof jsonLd.name === 'string' ? jsonLd.name : null,
      description: typeof jsonLd.description === 'string' ? jsonLd.description : null,
      imageUrl: absoluteImageUrl(image, origin),
    }
  }
  return { pharmacy, productUrl: searchUrl, found: false, name: null, description: null, imageUrl: null }
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
    searchPharmacy('Farmaciasaas', barcode, farmaciasaasUrl.toString()),
    searchPharmacy('Farmatodo', barcode, farmatodoUrl.toString()),
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
      results.push({ pharmacy, productUrl, found: false, name: null, description: null, imageUrl: null })
    }
  }
  return NextResponse.json({ results, failedPharmacies: failures })
}
