import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

type PharmacyName = 'Farmacia SAAS' | 'Farmatodo' | 'Farmaexpress' | 'FarmaGO' | 'TuZonaMarket' | 'Farmabien'
type PharmacyMatch = {
  pharmacy: PharmacyName
  productUrl: string
  found: boolean
  name: string | null
  description: string | null
  imageUrl: string | null
  brand: string | null
  score: number
}
type StoreProduct = {
  productName?: string
  name?: string
  description?: string
  link?: string
  brand?: string
  items?: Array<{
    ean?: string
    itemId?: string
    referenceId?: Array<{ Value?: string }>
    images?: Array<{ imageUrl?: string }>
  }>
}
type PharmacyConfig = {
  name: PharmacyName
  searchUrl: (term: string) => string
  vtex: boolean
}

const pharmacies: PharmacyConfig[] = [
  { name: 'Farmacia SAAS', searchUrl: (term) => `https://www.farmaciasaas.com/${encodeURIComponent(term)}?_q=${encodeURIComponent(term)}&map=ft`, vtex: true },
  { name: 'Farmatodo', searchUrl: (term) => `https://www.farmatodo.com.ve/buscar?product=${encodeURIComponent(term)}&departamento=Todos&filtros=`, vtex: true },
  { name: 'Farmaexpress', searchUrl: (term) => `https://www.farmaexpress.com/${encodeURIComponent(term)}?_q=${encodeURIComponent(term)}&map=ft`, vtex: true },
  { name: 'FarmaGO', searchUrl: (term) => `https://www.farmago.com.ve/website/search?search=${encodeURIComponent(term)}&order=name+asc`, vtex: false },
  { name: 'TuZonaMarket', searchUrl: (term) => `https://tuzonamarket.com/carabobo/buscar?q=${encodeURIComponent(term)}`, vtex: false },
  { name: 'Farmabien', searchUrl: (term) => `https://www.farmabien.com/productos?term=${encodeURIComponent(term)}`, vtex: false },
]

function normalizeName(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b(colgate|ml|mls|frasco|envase|unidad|unidades)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
}

function nameScore(name: string, query: string) {
  const queryTokens = new Set(normalizeName(query))
  const nameTokens = normalizeName(name)
  if (!queryTokens.size || !nameTokens.length) return 0
  return Math.round(100 * nameTokens.filter((token) => queryTokens.has(token)).length / queryTokens.size)
}

function decodeHtml(value: string) {
  return value.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
}

function absoluteUrl(value: string, base: string) {
  try {
    const url = new URL(decodeHtml(value), base)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

function makeMatch(pharmacy: PharmacyName, fields: Omit<PharmacyMatch, 'pharmacy' | 'found' | 'score'>, score: number): PharmacyMatch {
  return {
    pharmacy,
    found: true,
    ...fields,
    name: fields.name?.slice(0, 180) ?? null,
    description: fields.description?.slice(0, 1200) ?? null,
    imageUrl: fields.imageUrl ? absoluteUrl(fields.imageUrl, fields.productUrl || 'https://example.invalid') : null,
    score: Math.min(100, score
      + (fields.name ? 8 : 0)
      + (fields.description ? 4 : 0)
      + (fields.imageUrl ? 6 : 0)
      + (fields.productUrl ? 4 : 0)),
  }
}

function findStoreProducts(value: unknown, term: string, barcode: string, pharmacy: PharmacyName, origin: string) {
  if (!Array.isArray(value)) return []
  const matches: PharmacyMatch[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const product = entry as StoreProduct
    const exactItem = barcode ? product.items?.find((item) =>
      item.ean?.trim() === barcode || item.itemId?.trim() === barcode
      || item.referenceId?.some((ref) => ref.Value?.trim() === barcode)) : undefined
    const item = exactItem ?? product.items?.[0]
    const name = product.productName || product.name || null
    const relevance = name ? nameScore(name, term) : 0
    if (!item || !name || (barcode && !exactItem) || (!barcode && relevance < 35)) continue
    const link = product.link ? absoluteUrl(product.link, origin) : null
    const image = item.images?.[0]?.imageUrl ?? null
    matches.push(makeMatch(pharmacy, {
      productUrl: link ?? '',
      name,
      description: product.description ?? null,
      imageUrl: image,
      brand: product.brand ?? null,
    }, exactItem ? 78 : Math.max(30, relevance - 12)))
  }
  return matches.sort((left, right) => right.score - left.score).slice(0, 3)
}

function parseProductPage(html: string, config: PharmacyConfig, term: string, barcode: string, searchUrl: string) {
  const exactBarcode = barcode ? new RegExp(`(?:^|[/-])${barcode}(?:[/-]|$)`) : null
  const candidates: PharmacyMatch[] = []
  const anchors = html.matchAll(/<a\b([^>]*href=(?:"([^"]*)"|'([^']*)')[^>]*)>([\s\S]*?)<\/a>/gi)
  for (const anchor of anchors) {
    const href = decodeHtml(anchor[2] ?? anchor[3] ?? '')
    const contents = anchor[4]
    const titleMatch = contents.match(/<(?:h[1-6]|div|span)\b[^>]*class=["'][^"']*(?:product[_-]?(?:name|title)|h6)[^"']*["'][^>]*>([\s\S]*?)<\/(?:h[1-6]|div|span)>/i)
    const title = decodeHtml((titleMatch?.[1] ?? contents).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())
    const hasExactBarcode = Boolean(exactBarcode?.test(href))
    const relevance = nameScore(title, term)
    if (!title || (barcode && !hasExactBarcode) || (!barcode && relevance < 35)) continue
    const imageTag = contents.match(/<img\b[^>]*>/i)?.[0]
    const rawImage = imageTag?.match(/\b(?:src|data-src)=["']([^"']+)["']/i)?.[1]
    candidates.push(makeMatch(config.name, {
      productUrl: absoluteUrl(href, searchUrl) ?? searchUrl,
      name: title,
      description: null,
      imageUrl: rawImage ? absoluteUrl(rawImage, searchUrl) : null,
      brand: null,
    }, hasExactBarcode ? 66 : Math.max(25, relevance - 18)))
  }

  return candidates.sort((left, right) => right.score - left.score).slice(0, 3)
}

function parseJsonLdProducts(html: string, config: PharmacyConfig, term: string, barcode: string, searchUrl: string) {
  const matches: PharmacyMatch[] = []
  for (const script of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const root: unknown = JSON.parse(script[1])
      const pending: unknown[] = Array.isArray(root) ? [...root] : [root]
      while (pending.length) {
        const value = pending.shift()
        if (!value || typeof value !== 'object') continue
        if (Array.isArray(value)) {
          pending.push(...value)
          continue
        }
        const record = value as Record<string, unknown>
        const type = record['@type']
        if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) {
          const identifiers = [record.gtin, record.gtin8, record.gtin12, record.gtin13, record.gtin14, record.sku]
          const offer = record.offers && typeof record.offers === 'object' && !Array.isArray(record.offers)
            ? record.offers as Record<string, unknown>
            : null
          const exact = Boolean(barcode) && [...identifiers, offer?.gtin, offer?.sku].some((id) => String(id ?? '').trim() === barcode)
          const name = typeof record.name === 'string' ? record.name : ''
          const relevance = nameScore(name, term)
          if (exact || (!barcode && relevance >= 35)) {
            const image = typeof record.image === 'string'
              ? record.image
              : Array.isArray(record.image) ? record.image.find((entry): entry is string => typeof entry === 'string') : null
            const brand = typeof record.brand === 'string'
              ? record.brand
              : record.brand && typeof record.brand === 'object' && 'name' in record.brand ? String(record.brand.name) : null
            matches.push(makeMatch(config.name, {
              productUrl: typeof record.url === 'string' ? absoluteUrl(record.url, searchUrl) ?? searchUrl : searchUrl,
              name,
              description: typeof record.description === 'string' ? record.description : null,
              imageUrl: image ?? null,
              brand,
            }, exact ? 78 : Math.max(25, relevance - 12)))
          }
        }
        if (record['@graph']) pending.push(record['@graph'])
      }
    } catch {
      continue
    }
  }
  return matches.sort((left, right) => right.score - left.score).slice(0, 3)
}

async function searchPharmacy(config: PharmacyConfig, term: string, barcode: string): Promise<PharmacyMatch[]> {
  const searchUrl = config.searchUrl(term)
  const origin = new URL(searchUrl).origin
  if (config.vtex) {
    const endpoints = [
      `${origin}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(term)}&_from=0&_to=19`,
      ...(barcode ? [`${origin}/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${encodeURIComponent(barcode)}&_from=0&_to=19`] : []),
    ]
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 DentaStock product lookup' },
          signal: AbortSignal.timeout(7_000),
          cache: 'no-store',
        })
        if (!response.ok) continue
        const matches = findStoreProducts(await response.json(), term, barcode, config.name, origin)
        if (matches.length) return matches
      } catch (error) {
        console.error(`${config.name} catalog API failed`, error instanceof Error ? error.message : 'Unknown error')
      }
    }
  }

  try {
    const response = await fetch(searchUrl, {
      headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'Mozilla/5.0 DentaStock product lookup' },
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(`Search page returned status ${response.status}`)
    const html = await response.text()
    const jsonLdMatches = parseJsonLdProducts(html, config, term, barcode, searchUrl)
    const linkMatches = parseProductPage(html, config, term, barcode, searchUrl)
    return [...jsonLdMatches, ...linkMatches]
      .filter((match, index, all) => all.findIndex((other) => other.productUrl === match.productUrl) === index)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3)
  } catch (error) {
    console.error(`${config.name} search failed`, error instanceof Error ? error.message : 'Unknown error')
    return []
  }
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Sign in to search pharmacy catalogs.' }, { status: 401 })

  const params = new URL(request.url).searchParams
  const barcode = params.get('barcode')?.trim().slice(0, 128) ?? ''
  const query = params.get('q')?.trim().slice(0, 160) ?? ''
  const term = barcode || query
  if (!term || (barcode && !/^[\da-zA-Z-]{1,128}$/.test(barcode))) {
    return NextResponse.json({ error: 'Enter a product name or a valid barcode.' }, { status: 400 })
  }

  const settled = await Promise.allSettled(pharmacies.map((pharmacy) => searchPharmacy(pharmacy, term, barcode)))
  const results: PharmacyMatch[] = []
  const failedPharmacies: PharmacyName[] = []
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') results.push(...result.value)
    else {
      const pharmacy = pharmacies[index]
      failedPharmacies.push(pharmacy.name)
      console.error(`${pharmacy.name} search failed`, result.reason instanceof Error ? result.reason.message : 'Unknown error')
    }
  })

  for (const result of results) {
    const corroborations = results.filter((other) => other.pharmacy !== result.pharmacy
      && nameScore(result.name ?? '', other.name ?? '') >= 60).length
    result.score = Math.min(100, result.score + Math.min(12, corroborations * 6))
  }
  results.sort((left, right) => right.score - left.score)
  const suggestions = results.slice(0, 3)
  return NextResponse.json({ suggestions, bestMatch: suggestions[0] ?? null, failedPharmacies })
}
