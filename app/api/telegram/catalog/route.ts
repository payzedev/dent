import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('Supabase server configuration is missing')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

type ProductInput = {
  name?: unknown
  description?: unknown
  barcode?: unknown
  category_id?: unknown
  brand_id?: unknown
  presentation?: unknown
  product_type?: unknown
  model?: unknown
  color?: unknown
  approved_image_path?: unknown
}

function authorized(request: NextRequest) {
  const expected = process.env.DENTASTOCK_WORKER_SECRET
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  return Boolean(expected && provided && provided === expected)
}

async function telegramIdentity(request: NextRequest) {
  const supabase = getSupabase()
  const raw = request.headers.get('x-telegram-user-id')
  const telegramUserId = raw && /^\d{1,30}$/.test(raw) ? raw : null
  if (!telegramUserId) return null
  const { data } = await supabase.from('telegram_accounts').select('user_id').eq('telegram_user_id', telegramUserId).eq('enabled', true).maybeSingle()
  if (!data?.user_id) return null
  const { data: profile } = await supabase.from('profiles').select('id,role').eq('id', data.user_id).maybeSingle()
  if (!profile || profile.role !== 'admin') return null
  return { userId: profile.id, telegramUserId }
}

function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export async function GET(request: NextRequest) {
  const supabase = getSupabase()
  if (!authorized(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  if (!await telegramIdentity(request)) return NextResponse.json({ error: 'Cuenta de Telegram no vinculada o sin permisos' }, { status: 403 })
  const query = text(request.nextUrl.searchParams.get('q'), 128)
  if (query.length < 2) return NextResponse.json({ products: [] })
  const { data, error } = await supabase.rpc('search_catalog', { search_term: query, result_limit: 8 })
  if (error) return NextResponse.json({ error: 'No se pudo consultar el catálogo' }, { status: 500 })
  return NextResponse.json({ products: data ?? [] })
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase()
  if (!authorized(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const identity = await telegramIdentity(request)
  if (!identity) return NextResponse.json({ error: 'Cuenta de Telegram no vinculada o sin permisos' }, { status: 403 })
  let body: ProductInput & { idempotency_key?: unknown }
  try { body = await request.json() as ProductInput & { idempotency_key?: unknown } } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }
  const idempotencyKey = text(body.idempotency_key, 128)
  const name = text(body.name, 180)
  if (!name || !idempotencyKey) return NextResponse.json({ error: 'name e idempotency_key son obligatorios' }, { status: 400 })
  const allowedPresentations = new Set(['individual', 'set', 'box'])
  const values = {
    name,
    description: text(body.description, 2000),
    barcode: text(body.barcode, 128) || null,
    category_id: text(body.category_id, 64) || null,
    brand_id: text(body.brand_id, 64) || null,
    presentation: allowedPresentations.has(text(body.presentation, 20)) ? text(body.presentation, 20) : 'individual',
    product_type: text(body.product_type, 128), model: text(body.model, 128), color: text(body.color, 128),
    approved_image_path: text(body.approved_image_path, 512) || null,
    is_approved: false,
  }
  const { data: existing } = await supabase.from('telegram_catalog_operations').select('product_id').eq('idempotency_key', idempotencyKey).maybeSingle()
  if (existing?.product_id) return NextResponse.json({ product_id: existing.product_id, reused: true })
  if (values.barcode) {
    const { data: duplicate } = await supabase.from('catalog_products').select('id,name').eq('barcode', values.barcode).maybeSingle()
    if (duplicate) return NextResponse.json({ error: 'Ya existe un producto con ese código de barras', duplicate }, { status: 409 })
  }
  const { data: product, error } = await supabase.from('catalog_products').insert(values).select('id,name,description,barcode,category_id,brand_id,presentation,product_type,model,color,approved_image_path,is_approved').single()
  if (error || !product) return NextResponse.json({ error: 'No se pudo crear el producto' }, { status: 500 })
  const { error: operationError } = await supabase.from('telegram_catalog_operations').insert({ idempotency_key: idempotencyKey, telegram_user_id: identity.telegramUserId, product_id: product.id, created_by: identity.userId })
  if (operationError) {
    const { data: concurrent } = await supabase.from('telegram_catalog_operations').select('product_id').eq('idempotency_key', idempotencyKey).maybeSingle()
    if (concurrent?.product_id) return NextResponse.json({ product_id: concurrent.product_id, reused: true })
    return NextResponse.json({ error: 'Producto creado, pero no se pudo registrar la operación' }, { status: 500 })
  }
  return NextResponse.json({ product, product_id: product.id, reused: false }, { status: 201 })
}

export async function HEAD(request: NextRequest) {
  return authorized(request) ? new NextResponse(null, { status: 204 }) : new NextResponse(null, { status: 401 })
}
