import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 90

const model = 'deepseek-ai/deepseek-v4.1-flash'
const nimRequestTimeoutMs = 55_000
const nimMaxAttempts = 2
const nimEndpoint = 'https://integrate.api.nvidia.com/v1/chat/completions'
const imageLimit = 5 * 1024 * 1024

type CatalogMatch = {
  id: string
  name: string
  description: string
  barcode: string | null
  category_id: string | null
  brand_id: string | null
  approved_image_path: string | null
  category_ids: string[]
  presentation: 'individual' | 'set' | 'box'
}

type Suggestion = {
  name: string
  description: string
  barcode: string | null
  brand: string | null
  category_slugs: string[]
  presentation: 'individual' | 'set' | 'box'
}

type ChatResponse = {
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

async function searchCatalog(
  supabase: Awaited<ReturnType<typeof createClient>>,
  terms: string[],
  exactBarcodeTerm?: string,
) {
  for (const term of [...new Set(terms.map((value) => value.trim()).filter(Boolean))]) {
    const { data, error } = await supabase.rpc('search_catalog', { search_term: term.slice(0, 128), result_limit: 8 })
    if (error) return { error, match: null }
    const matches = (data ?? []) as CatalogMatch[]
    const exactBarcode = matches.find((product) => product.barcode?.toLowerCase() === term.toLowerCase())
    if (exactBarcode) return { error: null, match: exactBarcode }
    if (exactBarcodeTerm?.toLowerCase() === term.toLowerCase()) continue
    if (matches[0]) return { error: null, match: matches[0] }
  }
  return { error: null, match: null }
}

async function askModel(apiKey: string, prompt: string, imageDataUrl?: string): Promise<string> {
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }]
  if (imageDataUrl) content.push({ type: 'image_url', image_url: { url: imageDataUrl } })

  const requestBody = JSON.stringify({
    model,
    messages: [{ role: 'user', content }],
    response_format: { type: 'json_object' },
    temperature: 0.1,
    max_tokens: 700,
  })

  let response: Response | undefined
  let lastError: unknown
  for (let attempt = 1; attempt <= nimMaxAttempts; attempt += 1) {
    try {
      response = await fetch(nimEndpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: requestBody,
        signal: AbortSignal.timeout(nimRequestTimeoutMs),
      })
      if (response.ok || response.status < 500 || attempt === nimMaxAttempts) break
    } catch (error) {
      lastError = error
      if (attempt === nimMaxAttempts) {
        const details = error instanceof Error ? error.message : 'Unknown network error'
        throw new Error(`NVIDIA NIM request failed after ${attempt} attempts: ${details}`)
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
  }

  if (!response) {
    const details = lastError instanceof Error ? lastError.message : 'Unknown network error'
    throw new Error(`NVIDIA NIM request failed: ${details}`)
  }

  if (!response.ok) {
    console.error('NVIDIA NIM returned an error', response.status)
    throw new Error(`NVIDIA NIM request failed with status ${response.status}`)
  }

  const result = await response.json() as ChatResponse
  const message = result.choices?.[0]?.message?.content
  if (typeof message === 'string') return message
  if (Array.isArray(message)) return message.map((part) => part.text ?? '').join('')
  throw new Error('NVIDIA NIM returned an empty response')
}

function parseJsonResponse(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    const json = value.match(/\{[\s\S]*\}/)?.[0]
    if (json) {
      try {
        const parsed: unknown = JSON.parse(json)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
      } catch {
        throw new Error('NVIDIA NIM returned invalid JSON')
      }
    }
  }
  throw new Error('NVIDIA NIM returned invalid JSON')
}

function readIdentity(data: Record<string, unknown>) {
  return {
    barcode: typeof data.barcode === 'string' ? data.barcode.slice(0, 128).trim() : '',
    name: typeof data.product_name === 'string' ? data.product_name.slice(0, 160).trim() : '',
  }
}

function readSuggestion(data: Record<string, unknown>, validSlugs: Set<string>): Suggestion | null {
  const name = typeof data.name === 'string' ? data.name.trim().slice(0, 160) : ''
  if (!name) return null
  const presentation = data.presentation === 'set' || data.presentation === 'box' ? data.presentation : 'individual'
  const categorySlugs = Array.isArray(data.category_slugs)
    ? data.category_slugs.filter((slug): slug is string => typeof slug === 'string' && validSlugs.has(slug)).slice(0, 5)
    : []
  return {
    name,
    description: typeof data.description === 'string' ? data.description.slice(0, 2000) : '',
    barcode: typeof data.barcode === 'string' ? data.barcode.slice(0, 128) : null,
    brand: typeof data.brand === 'string' ? data.brand.slice(0, 120) : null,
    category_slugs: categorySlugs,
    presentation,
  }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return jsonError('Sign in to use product lookup.', 401)

  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > imageLimit + 64 * 1024) return jsonError('The product lookup request is too large.', 413)

  const form = await request.formData()
  const query = String(form.get('query') ?? '').trim().slice(0, 160)
  const barcode = String(form.get('barcode') ?? '').trim().slice(0, 128)
  const image = form.get('image')
  if (!query && !barcode && !(image instanceof File && image.size > 0)) {
    return jsonError('Enter a product name, barcode, or product photo.', 400)
  }

  let imageDataUrl: string | undefined
  if (image instanceof File && image.size > 0) {
    if (image.size > imageLimit || !['image/jpeg', 'image/png', 'image/webp'].includes(image.type)) {
      return jsonError('Choose a JPG, PNG, or WebP image up to 5 MB.', 400)
    }
    imageDataUrl = `data:${image.type};base64,${Buffer.from(await image.arrayBuffer()).toString('base64')}`
  }

  let lookupTerms = [barcode, query]
  let databaseResult = await searchCatalog(supabase, lookupTerms, barcode)
  if (databaseResult.error) {
    console.error('Product catalog search failed', databaseResult.error.message)
    return jsonError('The product catalog could not be searched. Please try again.', 500)
  }
  if (databaseResult.match) return NextResponse.json({ source: 'catalog', product: databaseResult.match })

  const apiKey = process.env.NVIDIA_NIM_API_KEY
  if (!apiKey) return jsonError('AI product lookup is not configured. Set the server-only NVIDIA_NIM_API_KEY.', 503)

  if (imageDataUrl && !barcode && !query) {
    let extraction: Record<string, unknown>
    try {
      const content = await askModel(
        apiKey,
        'Inspect this dental product photo only to read a visible barcode and/or identify a short product name for a catalog lookup. Do not provide product details or guesses. Return JSON only: {"barcode":"","product_name":""}. Use empty strings when uncertain.',
        imageDataUrl,
      )
      extraction = parseJsonResponse(content)
    } catch (error) {
      console.error('NVIDIA NIM image identification failed', error instanceof Error ? error.message : 'Unknown error')
      return jsonError('The product photo could not be analyzed. Try entering or scanning its barcode.', 502)
    }
    const identity = readIdentity(extraction)
    lookupTerms = [identity.barcode, identity.name].filter(Boolean)
    databaseResult = await searchCatalog(supabase, lookupTerms, identity.barcode)
    if (databaseResult.error) {
      console.error('Product catalog search failed', databaseResult.error.message)
      return jsonError('The product catalog could not be searched. Please try again.', 500)
    }
    if (databaseResult.match) return NextResponse.json({ source: 'catalog', product: databaseResult.match })
  }

  const { data: categories, error: categoryError } = await supabase
    .from('categories').select('slug,name_en,name_es').eq('is_active', true).order('sort_order')
  if (categoryError) {
    console.error('Product categories could not be loaded', categoryError.message)
    return jsonError('Product categories could not be loaded. Please try again.', 500)
  }

  const categoryOptions = (categories ?? []).map((category) => ({
    slug: category.slug,
    name: `${category.name_en} / ${category.name_es}`,
  }))
  const userSearch = lookupTerms.filter(Boolean).join('; ')
  const prompt = [
    'Identify a dental or orthodontic product from the supplied text and optional photo.',
    'This is a suggestion, not verified web research. Never invent a barcode, brand, or detail; use null or an empty string when unknown.',
    'Do not return image URLs or external links. Return JSON only with keys: name, description, barcode, brand, category_slugs, presentation.',
    'category_slugs must contain only exact slugs from this list: ' + JSON.stringify(categoryOptions),
    'presentation must be individual, set, or box.',
    userSearch ? `User search: ${userSearch}` : 'Identify the product from the photo.',
  ].join('\n')

  try {
    const content = await askModel(apiKey, prompt, imageDataUrl)
    const suggestion = readSuggestion(parseJsonResponse(content), new Set(categoryOptions.map((category) => category.slug)))
    if (!suggestion) return jsonError('The model could not identify this product. Enter its details manually.', 422)
    return NextResponse.json({ source: 'ai', suggestion })
  } catch (error) {
    console.error('NVIDIA NIM product suggestion failed', error instanceof Error ? error.message : 'Unknown error')
    return jsonError('AI product lookup failed. Please try again or enter the details manually.', 502)
  }
}
