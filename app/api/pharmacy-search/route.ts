import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

type PharmacyName = 'Farmacia SAAS' | 'Farmatodo' | 'Farmaexpress' | 'FarmaGO' | 'TuZonaMarket' | 'Farmabien'
type MatchEvidence = 'exact-barcode' | 'barcode-in-product-url'

type PharmacyMatch = {
  pharmacy: PharmacyName
  productUrl: string
  found: boolean
  name: string | null
  description: string | null
  imageUrl: string | null
  brand: string | null
  score: number
  evidence: MatchEvidence | null
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
    itemId?: string
    referenceId?: Array<{ Value?: string }>
    images?: Array<{ imageUrl?: string }>
  }>
}

type PharmacyConfig = {
  name: PharmacyName
  searchUrl: (barcode: string) => string
  vtex: boolean
}

const pharmacies: PharmacyConfig[] = [
  {
    name: 'Farmacia SAAS',
    searchUrl: (barcode) => `https://www.farmaciasaas.com/${encodeURIComponent(barcode)}?_q=${encodeURIComponent(barcode)}&map=ft`,
    vtex: true,
  },
  {
    name: 'Farmatodo',
    searchUrl: (barcode) => `https://www.farmatodo.com.ve/buscar?product=${encodeURIComponent(barcode)}&departamento=Todos&filtros=`,
    vtex: true,
  },
  {
    name: 'Farmaexpress',
    searchUrl: (barcode) => `https://www.farmaexpress.com/${encodeURIComponent(barcode)}?_q=${encodeURIComponent(barcode)}&map=ft`,
    vtex: true,
  },
  {
    name: 'FarmaGO',
    searchUrl: (barcode) => `https://www.farmago.com.ve/website/search?search=${encodeURIComponent(barcode)}&order=name+asc`,
    vtex: false,
  },
  {
    name: 'TuZonaMarket',
    searchUrl: (barcode) => `https://tuzonamarket.com/carabobo/buscar?q=${encodeURIComponent(barcode)}`,
    vtex: false,
  },
  {
    name: 'Farmabien',
    searchUrl: (barcode) => `https://www.farmabien.com/productos?term=${encodeURIComponent(barcode)}`,
    vtex: false,
  },
]

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

function absoluteUrl(value: string, baseUrl: string) {
  try {
    const url = new URL(decodeHtml(value), baseUrl)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

function plainText(value: string) {
  return decodeHtml(value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())
}

function scoreMatch(
  evidence: MatchEvidence,
  fields: { name: string | null; description: string | null; imageUrl: string | null; productUrl: string },
): number {
  const base = evidence === 'exact-barcode' ? 78 : 66
  return Math.min(100, base
    + (fields.name ? 8 : 0)
    + (fields.description ? 4 : 0)
    + (fields.imageUrl ? 6 : 0)
    + (fields.productUrl ? 4 : 0))
}

function makeMatch(
  pharmacy: PharmacyName,
  evidence: MatchEvidence,
  fields: { productUrl: string; name: string | null; description: string | null; imageUrl: string | null; brand?: string | null },
): PharmacyMatch {
  const normalizedUrl = absoluteUrl(fields.productUrl, 'https://example.invalid')
  const normalizedFields = { ...fields, productUrl: normalizedUrl ?? '' }
  return {
    pharmacy,
    productUrl: normalizedUrl ?? '',
    found: true,
    name: fields.name?.slice(0, 180) ?? null,
    description: fields.description?.slice(0, 1200) ?? null,
    imageUrl: fields.imageUrl ? absoluteUrl(fields.imageUrl, fields.productUrl) : null,
    brand: fields.brand?.slice(0, 120) ?? null,
    score: scoreMatch(evidence, normalizedFields),
    evidence,
  }
}

function parseJsonLdProduct(html: string, barcode: string, pharmacy: PharmacyName, searchUrl: string) {
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
          ? record.offers as Record<string, unknown>
          : null
        const matchesBarcode = [...identifiers, matchingOffer?.gtin, matchingOffer?.sku].some((value) => String(value ?? '').trim() === barcode)
        if (isProduct && matchesBarcode) {
          const productUrl = typeof record.url === 'string' ? absoluteUrl(record.url, searchUrl) ?? searchUrl : searchUrl
          const image = typeof record.image === 'string'
            ? record.image
            : Array.isArray(record.image) ? record.image.find((entry): entry is string => typeof entry === 'string') ?? null : null
          return makeMatch(pharmacy, 'exact-barcode', {
            productUrl,
            name: typeof record.name === 'string' ? record.name : null,
            description: typeof record.description === 'string' ? record.description : null,
            imageUrl: image,
            brand: typeof record.brand === 'string'
              ? record.brand
              : record.brand && typeof record.brand === 'object' && 'name' in record.brand
                ? String(record.brand.name)
                : null,
          })
        }
        if (record['@graph']) pending.push(record['@graph'])
      }
    } catch {
      continue
    }
  }
  return null
}

function findStoreProduct(value: unknown, barcode: string) {
  if (!Array.isArray(value)) return null
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const product = entry as StoreProduct
    const exactItem = product.items?.find((item) =>
      item.ean?.trim() === barcode
      || item.itemId?.trim() === barcode
      || item.referenceId?.some((reference) => reference.Value?.trim() === barcode))
    if (exactItem) return { product, item: exactItem }
  }
  return null
}

function parseExactProductLink(html: string, barcode: string, pharmacy: PharmacyName, searchUrl: string) {
  const anchors = html.matchAll(/<a\b([^>]*href=(?:"([^"]*)"|'([^']*)')[^>]*)>([\s\S]*?)<\/a>/gi)
  for (const anchor of anchors) {
    const href = decodeHtml(anchor[2] ?? anchor[3] ?? '')
    if (!new RegExp(`(?:^|[/-])${barcode}(?:[/-]|$)`).test(href)) continue
    const contents = anchor[4]
    const heading = contents.match(/<(?:h[1-6]|div|span)\b[^>]*class=["'][^"']*(?:product[_-]?(?:name|title)|h6)[^"']*["'][^>]*>([\s\S]*?)<\/(?:h[1-6]|div|span)>/i)
    const name = plainText(heading?.[1] ?? contents)
    if (!name) continue
    const imageTag = contents.match(/<img\b[^>]*>/i)?.[0]
    const imageSource = imageTag?.match(/\b(?:src|data-src)=["']([^"']+)["']/i)?.[1] ?? null
    const productUrl = absoluteUrl(href, searchUrl) ?? searchUrl
    return makeMatch(pharmacy, 'barcode-in-product-url', {
      productUrl,
      name,
      description: null,
      imageUrl: imageSource ? absoluteUrl(imageSource, searchUrl) : null,
    })
  }
  return null
}

function normalizeName(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b(colgate|ml|mls|frasco|envase|unidad|unidades)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
}

function corroborates(left: string | null, right: string | null) {
  if (!left || !right) return false
  const first = new Set(normalizeName(left))
  const second = new Set(normalizeName(right))
  if (!first.size || !second.size) return false
  const shared = [...first].filter((token) => second.has(token)).length
  return shared / Math.min(first.size, second.size) >= 0.6
}

async function fetchSearchPage(url: string) {
  const response = await fetch(url, {
    headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'Mozilla/5.0 DentaStock product lookup' },
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`Search page returned status ${response.status}`)
  return response.text()
}

async function searchPharmacy(config: PharmacyConfig, barcode: string): Promise<PharmacyMatch> {
  const searchUrl = config.searchUrl(barcode)
  const origin = new URL(searchUrl).origin

  if (config.vtex) {
    const apiUrls = [
      `${origin}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(barcode)}&_from=0&_to=9`,
      `${origin}/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${encodeURIComponent(barcode)}&_from=0&_to=9`,
    ]
    for (const apiUrl of apiUrls) {
      try {
        const response = await fetch(apiUrl, {
          headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 DentaStock product lookup' },
          signal: AbortSignal.timeout(7_000),
          cache: 'no-store',
        })
        if (!response.ok) continue
        const result = findStoreProduct(await response.json(), barcode)
        if (!result) continue
        const { product, item } = result
        const productUrl = product.link ? absoluteUrl(product.link, origin) ?? searchUrl : searchUrl
        const imageUrl = item.images?.[0]?.imageUrl ? absoluteUrl(item.images[0].imageUrl, origin) : null
        return makeMatch(config.name, 'exact-barcode', {
          productUrl,
          name: product.productName || product.name || null,
          description: product.description || null,
          imageUrl,
          brand: product.brand || null,
        })
      } catch (error) {
        console.error(`${config.name} catalog API failed`, error instanceof Error ? error.message : 'Unknown error')
      }
    }
  }

  try {
    const html = await fetchSearchPage(searchUrl)
    const structuredMatch = parseJsonLdProduct(html, barcode, config.name, searchUrl)
    if (structuredMatch) return structuredMatch
    const exactProductLink = parseExactProductLink(html, barcode, config.name, searchUrl)
    if (exactProductLink) return exactProductLink
  } catch (error) {
    console.error(`${config.name} search failed`, error instanceof Error ? error.message : 'Unknown error')
  }

  return {
    pharmacy: config.name,
    productUrl: searchUrl,
    found: false,
    name: null,
    description: null,
    imageUrl: null,
    brand: null,
    score: 0,
    evidence: null,
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

  const settled = await Promise.allSettled(pharmacies.map((pharmacy) => searchPharmacy(pharmacy, barcode)))
  const results: PharmacyMatch[] = []
  const failedPharmacies: PharmacyName[] = []
  for (const [index, result] of settled.entries()) {
    if (result.status === 'fulfilled') results.push(result.value)
    else {
      const pharmacy = pharmacies[index]
      failedPharmacies.push(pharmacy.name)
      console.error(`${pharmacy.name} search failed`, result.reason instanceof Error ? result.reason.message : 'Unknown error')
      results.push({
        pharmacy: pharmacy.name,
        productUrl: pharmacy.searchUrl(barcode),
        found: false,
        name: null,
        description: null,
        imageUrl: null,
        brand: null,
        score: 0,
        evidence: null,
      })
    }
  }

  for (const result of results) {
    if (!result.found) continue
    const corroborationCount = results.filter((other) =>
      other.found && other.pharmacy !== result.pharmacy && corroborates(result.name, other.name),
    ).length
    result.score = Math.min(100, result.score + Math.min(12, corroborationCount * 6))
  }

  const bestMatch = results
    .filter((result) => result.found && result.name)
    .sort((left, right) => right.score - left.score)[0] ?? null

  return NextResponse.json({ results, bestMatch, failedPharmacies })
}
