import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('Supabase server configuration is missing')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

function configurationError(error: unknown) {
  return error instanceof Error && error.message === 'Supabase server configuration is missing'
}

function databaseError() {
  return NextResponse.json({ error: 'Error de configuración o base de datos del catálogo' }, { status: 500 })
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

function uuid(value: unknown) {
  const candidate = text(value, 64)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate) ? candidate : null
}

async function resolveReference(supabase: ReturnType<typeof getSupabase>, value: unknown, table: 'categories' | 'brands') {
  const label = text(value, 180)
  if (!label) return null
  const id = uuid(value)
  if (table === 'categories') {
    const query = supabase.from('categories').select('id').eq('is_active', true)
    const { data } = id ? await query.eq('id', id).maybeSingle() : await query.or(`name_en.ilike.${label},name_es.ilike.${label}`).limit(2)
    return Array.isArray(data) ? (data.length === 1 ? data[0].id : null) : (data?.id ?? null)
  }
  const query = supabase.from('brands').select('id').is('clinic_id', null)
  const { data } = id ? await query.eq('id', id).maybeSingle() : await query.ilike('name', label).limit(2)
  return Array.isArray(data) ? (data.length === 1 ? data[0].id : null) : (data?.id ?? null)
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    const supabase = getSupabase()
    if (!await telegramIdentity(request)) return NextResponse.json({ error: 'Cuenta de Telegram no vinculada o sin permisos' }, { status: 403 })
    const query = text(request.nextUrl.searchParams.get('q'), 128)
    if (query.length < 2) return NextResponse.json({ products: [] })
    const { data, error } = await supabase.rpc('search_catalog', { search_term: query, result_limit: 8 })
    if (error) return databaseError()
    return NextResponse.json({ products: data ?? [] })
  } catch (error) {
    return configurationError(error) ? NextResponse.json({ error: 'Servicio de catálogo no configurado' }, { status: 500 }) : databaseError()
  }
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    const supabase = getSupabase()
    const identity = await telegramIdentity(request)
    if (!identity) return NextResponse.json({ error: 'Cuenta de Telegram no vinculada o sin permisos' }, { status: 403 })
  let body: ProductInput & { idempotency_key?: unknown }
  try { body = await request.json() as ProductInput & { idempotency_key?: unknown } } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }
  const idempotencyKey = text(body.idempotency_key, 128)
  const name = text(body.name, 180)
  if (!name || !idempotencyKey) return NextResponse.json({ error: 'name e idempotency_key son obligatorios' }, { status: 400 })
  const allowedPresentations = new Set(['individual', 'set', 'box'])
  const categoryId = await resolveReference(supabase, body.category_id, 'categories')
  const brandId = await resolveReference(supabase, body.brand_id, 'brands')
  if (text(body.category_id, 64) && !categoryId) return NextResponse.json({ error: 'Categoría inválida o ambigua' }, { status: 400 })
  if (text(body.brand_id, 64) && !brandId) return NextResponse.json({ error: 'Marca inválida, ambigua o no global' }, { status: 400 })
  const values = {
    name,
    description: text(body.description, 2000),
    barcode: text(body.barcode, 128) || null,
    category_id: categoryId,
    brand_id: brandId,
    presentation: allowedPresentations.has(text(body.presentation, 20)) ? text(body.presentation, 20) : 'individual',
    product_type: text(body.product_type, 128), model: text(body.model, 128), color: text(body.color, 128),
    approved_image_path: text(body.approved_image_path, 512) || null,
    is_approved: false,
  }
  const { data: result, error } = await supabase.rpc('create_telegram_catalog_product', {
    p_idempotency_key: idempotencyKey,
    p_telegram_user_id: identity.telegramUserId,
    p_created_by: identity.userId,
    p_name: values.name,
    p_description: values.description,
    p_barcode: values.barcode,
    p_category_id: values.category_id,
    p_brand_id: values.brand_id,
    p_presentation: values.presentation,
    p_product_type: values.product_type,
    p_model: values.model,
    p_color: values.color,
    p_approved_image_path: values.approved_image_path,
  })
  if (error) {
    if (error.code === '23505' || error.message?.includes('duplicate barcode')) {
      return NextResponse.json({ error: 'Ya existe un producto con ese código de barras' }, { status: 409 })
    }
    return NextResponse.json({ error: 'No se pudo crear el producto' }, { status: 500 })
  }
  const operation = result?.[0]
  if (!operation?.product_id) return NextResponse.json({ error: 'Respuesta inválida del catálogo' }, { status: 500 })
    return NextResponse.json({ product_id: operation.product_id, reused: operation.reused }, { status: operation.reused ? 200 : 201 })
  } catch (error) {
    return configurationError(error) ? NextResponse.json({ error: 'Servicio de catálogo no configurado' }, { status: 500 }) : databaseError()
  }
}

export async function HEAD(request: NextRequest) {
  return authorized(request) ? new NextResponse(null, { status: 204 }) : new NextResponse(null, { status: 401 })
}
