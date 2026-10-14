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

function databaseError(requestId: string, status = 500, message = 'Error de configuración o base de datos del catálogo') {
  return NextResponse.json({ error: message, request_id: requestId }, { status })
}

function requestId(request: NextRequest) {
  return request.headers.get('x-request-id')?.trim().slice(0, 128) || crypto.randomUUID()
}

function logRpcError(requestId: string, functionName: string, error: { code?: string; message?: string; details?: string; hint?: string }) {
  console.error('[telegram/catalog] RPC failed', {
    request_id: requestId,
    function: functionName,
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  })
}

type ProductInput = {
  name?: unknown
  description?: unknown
  barcode?: unknown
  category_id?: unknown
  brand_id?: unknown
  category_name?: unknown
  brand_name?: unknown
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
  const { data, error: accountError } = await supabase.from('telegram_accounts').select('user_id').eq('telegram_user_id', telegramUserId).eq('enabled', true).maybeSingle()
  if (accountError) throw accountError
  if (!data?.user_id) return null
  const { data: profile, error: profileError } = await supabase.from('profiles').select('id,role').eq('id', data.user_id).maybeSingle()
  if (profileError) throw profileError
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
  const id = requestId(request)
  if (!authorized(request)) return NextResponse.json({ error: 'No autorizado', request_id: id }, { status: 401 })
  try {
    const supabase = getSupabase()
    if (!await telegramIdentity(request)) return NextResponse.json({ error: 'Cuenta de Telegram no vinculada o sin permisos', request_id: id }, { status: 403 })
    const query = text(request.nextUrl.searchParams.get('q'), 128)
    if (query.length < 2) return NextResponse.json({ products: [] })
    const { data, error } = await supabase.rpc('search_catalog', { search_term: query, result_limit: 8 })
    if (error) {
      logRpcError(id, 'search_catalog', error)
      const status = error.code === 'PGRST202' ? 503 : 500
      const message = status === 503 ? 'El buscador del catálogo no está disponible' : 'No se pudo consultar el catálogo'
      return databaseError(id, status, message)
    }
    return NextResponse.json({ products: Array.isArray(data) ? data : [], request_id: id })
  } catch (error) {
    if (configurationError(error)) return databaseError(id, 500, 'Servicio de catálogo no configurado')
    console.error('[telegram/catalog] Unexpected request failure', { request_id: id, error: error instanceof Error ? error.message : 'unknown error' })
    return databaseError(id)
  }
}

export async function POST(request: NextRequest) {
  const id = requestId(request)
  if (!authorized(request)) return NextResponse.json({ error: 'No autorizado', request_id: id }, { status: 401 })
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
  const categoryId = uuid(body.category_id)
  const brandId = uuid(body.brand_id)
  const categoryName = text(body.category_name, 180)
  const brandName = text(body.brand_name, 180)
  if (text(body.category_id, 64) && !categoryId) return NextResponse.json({ error: 'category_id inválido; use category_name para una propuesta' }, { status: 400 })
  if (text(body.brand_id, 64) && !brandId) return NextResponse.json({ error: 'brand_id inválido; use brand_name para una propuesta' }, { status: 400 })
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
  const { data: result, error } = await supabase.rpc('create_telegram_catalog_product_pending', {
    p_idempotency_key: idempotencyKey,
    p_telegram_user_id: identity.telegramUserId,
    p_created_by: identity.userId,
    p_name: values.name,
    p_description: values.description,
    p_barcode: values.barcode,
    p_category_id: values.category_id,
    p_brand_id: values.brand_id,
    p_category_name: categoryName,
    p_brand_name: brandName,
    p_presentation: values.presentation,
    p_product_type: values.product_type,
    p_model: values.model,
    p_color: values.color,
    p_approved_image_path: values.approved_image_path,
  })
  if (error) {
    logRpcError(id, 'create_telegram_catalog_product_pending', error)

    if (error.code === '23505' || error.message?.toLowerCase().includes('duplicate barcode')) {
      return NextResponse.json({ error: 'Ya existe un producto con ese código de barras', request_id: id }, { status: 409 })
    }
    if (error.code === '22023') {
      return NextResponse.json({ error: 'Los datos del producto no son válidos', request_id: id }, { status: 400 })
    }
    if (error.code === '42501') {
      return NextResponse.json({ error: 'La cuenta no tiene permisos para crear productos', request_id: id }, { status: 403 })
    }
    if (error.code === 'PGRST202' || error.code === '42883' || error.message?.toLowerCase().includes('function') && error.message.toLowerCase().includes('does not exist')) {
      return NextResponse.json({ error: 'Falta aplicar la migración del catálogo de Telegram en Supabase', error_code: 'CATALOG_MIGRATION_REQUIRED', request_id: id }, { status: 503 })
    }
    if (error.code === '42P01' || error.code === '42703' || error.code === 'PGRST204') {
      return NextResponse.json({ error: 'El esquema del catálogo de Telegram está incompleto en Supabase', error_code: 'CATALOG_SCHEMA_REQUIRED', request_id: id }, { status: 503 })
    }
    return databaseError(id)
  }
  const operation = result?.[0]
  if (!operation?.product_id) {
    console.error('[telegram/catalog] Invalid RPC response', { request_id: id, function: 'create_telegram_catalog_product_pending' })
    return databaseError(id, 502, 'Respuesta inválida del servicio de catálogo')
  }
  return NextResponse.json({ product_id: operation.product_id, reused: operation.reused, request_id: id }, { status: operation.reused ? 200 : 201 })
  } catch (error) {
    if (configurationError(error)) return databaseError(id, 500, 'Servicio de catálogo no configurado')
    console.error('[telegram/catalog] Unexpected request failure', { request_id: id, error: error instanceof Error ? error.message : 'unknown error' })
    return databaseError(id)
  }
}

export async function HEAD(request: NextRequest) {
  const id = requestId(request)
  return authorized(request) ? new NextResponse(null, { status: 204, headers: { 'x-request-id': id } }) : new NextResponse(null, { status: 401, headers: { 'x-request-id': id } })
}
