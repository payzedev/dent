import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const storeDomains = [
  'amazon.com',
  'es.aliexpress.com',
  'alibaba.com',
  'bluedentalvzla.com',
  'dymstudents.com',
  'dentaltix.com',
]
const exaEndpoint = 'https://api.exa.ai/search'

type ExaResult = {
  title?: string
  url?: string
  text?: string
  summary?: string
  highlights?: string[]
}
type StoreSuggestion = {
  store: string
  name: string
  url: string
  description: string
  imageUrl: string | null
  score: number
}

function normalizedTokens(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter((token) => token.length > 1)
}

function getScore(result: ExaResult, term: string, barcode: string) {
  const searchable = `${result.title ?? ''} ${result.url ?? ''} ${result.summary ?? ''} ${(result.highlights ?? []).join(' ')}`
  if (barcode && searchable.includes(barcode)) return 100
  const queryTokens = new Set(normalizedTokens(term))
  if (!queryTokens.size) return 0
  const resultTokens = new Set(normalizedTokens(searchable))
  return Math.round(100 * [...queryTokens].filter((token) => resultTokens.has(token)).length / queryTokens.size)
}

function storeName(url: URL) {
  const host = url.hostname.toLowerCase()
  if (host === 'amazon.com' || host.endsWith('.amazon.com')) return 'Amazon'
  if (host === 'es.aliexpress.com' || host.endsWith('.aliexpress.com')) return 'AliExpress'
  if (host === 'alibaba.com' || host.endsWith('.alibaba.com')) return 'Alibaba'
  if (host === 'bluedentalvzla.com' || host.endsWith('.bluedentalvzla.com')) return 'Blue Dental Venezuela'
  if (host === 'dymstudents.com' || host.endsWith('.dymstudents.com')) return 'DYM Students'
  if (host === 'dentaltix.com' || host.endsWith('.dentaltix.com')) return 'Dentaltix'
  return null
}

async function readProductImage(pageUrl: string) {
  try {
    const response = await fetch(pageUrl, {
      headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'Mozilla/5.0 DentaStock product lookup' },
      signal: AbortSignal.timeout(7_000),
      cache: 'no-store',
    })
    if (!response.ok) return null
    const declaredLength = Number(response.headers.get('content-length') ?? 0)
    if (declaredLength > 1_500_000) return null
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength > 1_500_000) return null
    const html = new TextDecoder().decode(bytes)
    const tags = html.match(/<meta\b[^>]*>/gi) ?? []
    for (const tag of tags) {
      const attrs = new Map<string, string>()
      for (const attr of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
        attrs.set(attr[1].toLowerCase(), attr[2] ?? attr[3] ?? attr[4] ?? '')
      }
      if (!['og:image', 'twitter:image'].includes(attrs.get('property')?.toLowerCase() ?? attrs.get('name')?.toLowerCase() ?? '')) continue
      const content = attrs.get('content')
      if (!content) continue
      const url = new URL(content, pageUrl)
      if (url.protocol === 'https:') return url.toString()
    }
  } catch (error) {
    console.error('Could not read image metadata from store result', error instanceof Error ? error.message : 'Unknown error')
  }
  return null
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Sign in to search online stores.' }, { status: 401 })

  const params = new URL(request.url).searchParams
  const barcode = params.get('barcode')?.trim().slice(0, 128) ?? ''
  const query = params.get('q')?.trim().slice(0, 160) ?? ''
  const term = barcode || query
  if (!term || (barcode && !/^[\da-zA-Z-]{1,128}$/.test(barcode))) {
    return NextResponse.json({ error: 'Enter a product name or a valid barcode.' }, { status: 400 })
  }
  const apiKey = process.env.EXA_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'Online store search is not configured. Set EXA_API_KEY.' }, { status: 503 })

  const response = await fetch(exaEndpoint, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `${term} dental product product listing`,
      type: 'auto',
      includeDomains: storeDomains,
      numResults: 18,
      contents: { highlights: true },
    }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) {
    console.error('Exa store search returned an error', response.status)
    return NextResponse.json({ error: `Online store search failed with status ${response.status}.` }, { status: 502 })
  }

  const data = await response.json() as { results?: ExaResult[] }
  const results = (data.results ?? []).flatMap((result) => {
    if (!result.title || !result.url) return []
    try {
      const url = new URL(result.url)
      if (url.protocol !== 'https:') return []
      const store = storeName(url)
      const score = getScore(result, term, barcode)
      if (!store || score < 25) return []
      return [{
        store,
        name: result.title.slice(0, 180),
        url: url.toString(),
        description: (result.summary || result.highlights?.join(' ') || result.text || '').slice(0, 1000),
        imageUrl: null,
        score,
      }]
    } catch {
      return []
    }
  })

  const distinct = results
    .filter((result, index) => results.findIndex((other) => other.url === result.url) === index)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
  const withImages = await Promise.all(distinct.map(async (result) => ({
    ...result,
    imageUrl: await readProductImage(result.url),
  })))
  return NextResponse.json({ suggestions: withImages })
}
