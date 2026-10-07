'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { CategoryPicker } from '@/components/category-picker'
import { SearchIcon, XIcon } from '@/components/icons'

type Category = { id: string; slug: string; name_en: string; name_es: string; color_hex: string }
type Brand = { id: string; name: string }
type Product = { id: string; name: string; approved_image_path: string | null }
type InventoryItem = {
  id: string
  name: string
  description: string
  quantity: number
  min_quantity: number
  expiry_date: string | null
  status: 'new' | 'opened' | 'used' | 'defective' | 'missing'
  created_at: string
  barcode: string | null
  image_path: string | null
  category_id: string | null
  category_ids: string[]
  brand_id: string | null
  product_id: string | null
  presentation: 'individual' | 'set' | 'box'
  product_type: string
  model: string
  color: string
}

const inventoryPageSize = 50

export function InventoryPage() {
  const t = useTranslations()
  const locale = useLocale()
  const [items, setItems] = useState<InventoryItem[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [images, setImages] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(0)
  const [totalItems, setTotalItems] = useState(0)
  const [selected, setSelected] = useState<InventoryItem | null>(null)
  const [clinicId, setClinicId] = useState('')
  const [userId, setUserId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const supabase = useMemo(() => createClient(), [])

  const load = useCallback(async () => {
    setError('')
    const [{ data: { user }, error: authError }, { data: rows, error: itemsError }, { data: categoryRows, error: categoryError }, { data: brandRows, error: brandError }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.rpc('search_inventory', {
        search_term: query,
        category_filter: categoryFilter || null,
        status_filter: statusFilter || null,
        result_offset: page * inventoryPageSize,
        result_limit: inventoryPageSize,
      }),
      supabase.from('categories').select('id,slug,name_en,name_es,color_hex').eq('is_active', true).order('sort_order'),
      supabase.from('brands').select('id,name').order('name'),
    ])
    const loadError = authError || itemsError || categoryError || brandError
    if (loadError) {
      setError(loadError.message)
      return
    }
    if (!user) { setError(t('sessionRequired')); return }
    const { data: profile, error: profileError } = await supabase.from('profiles').select('primary_clinic_id').eq('id', user.id).single()
    if (profileError) { setError(profileError.message); return }
    setClinicId(profile.primary_clinic_id || '')
    setUserId(user.id)
    const inventoryRows = (rows ?? []) as (InventoryItem & { total_count: number | string })[]
    setTotalItems(Number(inventoryRows[0]?.total_count ?? 0))
    const itemIds = inventoryRows.map((item) => item.id)
    const { data: itemCategoryRows, error: itemCategoryError } = itemIds.length
      ? await supabase.from('inventory_item_categories').select('item_id,category_id').in('item_id', itemIds)
      : { data: [], error: null }
    if (itemCategoryError) {
      setError(itemCategoryError.message)
      return
    }
    const categoryIdsByItem = new Map<string, string[]>()
    for (const row of itemCategoryRows ?? []) {
      categoryIdsByItem.set(row.item_id, [...(categoryIdsByItem.get(row.item_id) ?? []), row.category_id])
    }
    const inventory = inventoryRows.map(({ total_count: _totalCount, ...item }) => ({
      ...item,
      category_ids: categoryIdsByItem.get(item.id) ?? (item.category_id ? [item.category_id] : []),
    }))
    const categoryList = (categoryRows ?? []) as Category[]
    const brandList = (brandRows ?? []) as Brand[]
    setItems(inventory)
    setCategories(categoryList)
    setBrands(brandList)

    const productIds = [...new Set(inventory.flatMap((item) => item.product_id ? [item.product_id] : []))]
    const { data: productRows, error: productError } = productIds.length
      ? await supabase.from('catalog_products').select('id,name,approved_image_path').in('id', productIds)
      : { data: [], error: null }
    if (productError) {
      setError(productError.message)
      return
    }
    const productList = (productRows ?? []) as Product[]
    setProducts(productList)
    const paths = [...new Set(inventory.flatMap((item) => [
      item.image_path,
      productList.find((product) => product.id === item.product_id)?.approved_image_path ?? null,
    ]).filter((path): path is string => Boolean(path)))]
    const imageMap = Object.fromEntries(paths.map((path) => [
      path,
      `/api/inventory-image?path=${encodeURIComponent(path)}&user=${encodeURIComponent(user.id)}`,
    ]))
    setImages(imageMap)
  }, [categoryFilter, page, query, statusFilter, supabase, t])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => {
    if (page > 0 && page * inventoryPageSize >= totalItems) {
      setPage(Math.max(0, Math.ceil(totalItems / inventoryPageSize) - 1))
    }
  }, [page, totalItems])

  useEffect(() => {
    if (!categories.length) return
    const requestedCategory = new URLSearchParams(window.location.search).get('category')
    const category = categories.find((value) => value.slug === requestedCategory || value.id === requestedCategory)
    if (category) setCategoryFilter(category.id)
  }, [categories])

  const visibleItems = items

  const categoryNames = (ids: string[]) => {
    const names = ids.map((id) => categories.find((value) => value.id === id))
      .filter((category): category is Category => Boolean(category))
      .map((category) => locale === 'es' ? category.name_es : category.name_en)
    return names.length ? names.join(', ') : t('uncategorized')
  }

  async function changeQuantity(item: InventoryItem, change: number) {
    const quantity = Math.max(0, item.quantity + change)
    setBusy(true)
    setError('')
    const { error: updateError } = await supabase.from('inventory_items').update({
      quantity,
      status: quantity === 0 ? 'missing' : item.status === 'missing' ? 'new' : item.status,
    }).eq('id', item.id)
    setBusy(false)
    if (updateError) { setError(updateError.message); return }
    await load()
    setSelected((current) => current?.id === item.id ? { ...current, quantity, status: quantity === 0 ? 'missing' : current.status === 'missing' ? 'new' : current.status } : current)
  }

  async function removeItem(item: InventoryItem) {
    if (!window.confirm(t('confirmDeleteItem'))) return
    setBusy(true)
    const { error: deleteError } = await supabase.from('inventory_items').delete().eq('id', item.id)
    setBusy(false)
    if (deleteError) { setError(deleteError.message); return }
    setSelected(null)
    await load()
  }

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    const form = new FormData(event.currentTarget)
    const quantity = Number(form.get('quantity'))
    const categoryIds = [...new Set(form.getAll('category_ids').map(String).filter(Boolean))]
    if (!Number.isInteger(quantity) || quantity < 0 || !Number.isInteger(Number(form.get('min_quantity'))) || Number(form.get('min_quantity')) < 0) {
      setError(t('invalidItemDetails'))
      return
    }
    setBusy(true)
    const photoValue = form.get('edit_image')
    const photo = photoValue instanceof File && photoValue.size > 0 ? photoValue : null
    let imagePath = form.get('remove_custom_image') === 'on' ? null : selected.image_path
    if (photo) {
      if (photo.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(photo.type)) {
        setBusy(false)
        setError(t('invalidImage'))
        return
      }
      const extension = photo.type === 'image/png' ? 'png' : photo.type === 'image/webp' ? 'webp' : 'jpg'
      imagePath = `${clinicId}/${userId}/${crypto.randomUUID()}.${extension}`
      const { error: uploadError } = await supabase.storage.from('inventory-images').upload(imagePath, photo, { contentType: photo.type })
      if (uploadError) { setBusy(false); setError(uploadError.message); return }
    }
    const { error: updateError } = await supabase.from('inventory_items').update({
      name: String(form.get('name')).trim(),
      description: String(form.get('description')).trim(),
      barcode: String(form.get('barcode')).trim() || null,
      category_id: categoryIds[0] || null,
      brand_id: String(form.get('brand_id')) || null,
      presentation: String(form.get('presentation') || 'individual'),
      product_type: String(form.get('product_type') || '').trim(),
      model: String(form.get('model') || '').trim(),
      color: String(form.get('color') || '').trim(),
      quantity,
      min_quantity: Number(form.get('min_quantity')),
      expiry_date: String(form.get('expiry_date') || '') || null,
      status: quantity === 0 ? 'missing' : String(form.get('status')),
      image_path: imagePath,
    }).eq('id', selected.id)
    if (updateError) {
      if (photo && imagePath) {
        const { error: cleanupError } = await supabase.storage.from('inventory-images').remove([imagePath])
        if (cleanupError) { setBusy(false); setError(`${updateError.message} ${t('uploadedImageCleanupFailed')}: ${cleanupError.message}`); return }
      }
      setBusy(false)
      setError(updateError.message)
      return
    }
    const { error: categoryError } = await supabase.rpc('set_inventory_item_categories', {
      target_item: selected.id,
      target_categories: categoryIds,
    })
    if (categoryError) {
      setBusy(false)
      setError(categoryError.message)
      return
    }
    if (selected.image_path && selected.image_path !== imagePath) {
      const { error: cleanupError } = await supabase.storage.from('inventory-images').remove([selected.image_path])
      if (cleanupError) { setBusy(false); setError(cleanupError.message); return }
    }
    setBusy(false)
    setSelected(null)
    await load()
  }

  return (
    <section className="inventory-content">
      <div className="page-heading">
        <div><p className="eyebrow">{t('inventory')}</p><h1>{t('inventoryTitle')}</h1><p className="subtle">{t('inventoryDescription', { count: totalItems })}</p></div>
      </div>
      <div className="inventory-filters">
        <label className="search-field"><SearchIcon /><span className="sr-only">{t('searchInventory')}</span><input value={query} onChange={(event) => { setPage(0); setQuery(event.target.value) }} placeholder={t('searchNameOrBarcode')} /></label>
        <label><span className="sr-only">{t('category')}</span><select value={categoryFilter} onChange={(event) => { setPage(0); setCategoryFilter(event.target.value) }}><option value="">{t('allCategories')}</option>{categories.map((category) => <option key={category.id} value={category.id}>{locale === 'es' ? category.name_es : category.name_en}</option>)}</select></label>
        <label><span className="sr-only">{t('status')}</span><select value={statusFilter} onChange={(event) => { setPage(0); setStatusFilter(event.target.value) }}><option value="">{t('allStatuses')}</option><option value="new">{t('new')}</option><option value="opened">{t('opened')}</option><option value="used">{t('used')}</option><option value="defective">{t('defective')}</option><option value="missing">{t('missing')}</option></select></label>
      </div>
      {error && <p role="alert" className="error-message">{error}</p>}
      {visibleItems.length ? <div className="inventory-grid">{visibleItems.map((item) => {
        const product = products.find((value) => value.id === item.product_id)
        const path = item.image_path || product?.approved_image_path
        const imagePath = item.image_path && images[item.image_path] ? item.image_path : product?.approved_image_path && images[product.approved_image_path] ? product.approved_image_path : path
        const image = imagePath ? images[imagePath] : ''
        return <button key={item.id} type="button" className="inventory-card card" onClick={() => setSelected(item)}>
          <span className="inventory-image">{image && imagePath ? <img src={image} alt="" loading="lazy" decoding="async" onError={() => setImages((current) => ({ ...current, [imagePath]: '' }))} /> : <span aria-hidden="true">✳</span>}</span>
          <span className="inventory-card-copy"><strong>{item.name}</strong><span>{categoryNames(item.category_ids)}</span><span>{t('quantityPresentation', { count: item.quantity, presentation: t(item.presentation) })}</span></span>
          <span className={`status-badge status-${item.status}`}>{t(item.status)}</span>
        </button>
      })}</div> : <div className="card empty-state"><h2>{t('noItemsFound')}</h2><p className="subtle">{totalItems ? t('adjustInventorySearch') : t('emptyInventoryDescription')}</p></div>}
      {totalItems > inventoryPageSize && <nav className="pagination-controls" aria-label={t('inventoryPagination')}>
        <button type="button" className="secondary-button" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>{t('previousPage')}</button>
        <span className="field-hint">{t('pageOf', { page: page + 1, total: Math.ceil(totalItems / inventoryPageSize) })}</span>
        <button type="button" className="secondary-button" disabled={(page + 1) * inventoryPageSize >= totalItems} onClick={() => setPage((current) => current + 1)}>{t('nextPage')}</button>
      </nav>}

      {selected && <div className="dialog-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setSelected(null) }}>
        <section role="dialog" aria-modal="true" aria-labelledby="item-dialog-title" className="item-dialog card">
          <button type="button" className="icon-button dialog-close" aria-label={t('close')} onClick={() => setSelected(null)}><XIcon /></button>
          <p className="eyebrow">{t('itemDetails')}</p><h2 id="item-dialog-title">{selected.name}</h2>
          <p className="subtle">{categoryNames(selected.category_ids)}{selected.brand_id ? ` · ${brands.find((brand) => brand.id === selected.brand_id)?.name ?? ''}` : ''}</p>
          {(() => {
            const product = products.find((value) => value.id === selected.product_id)
            const path = selected.image_path || product?.approved_image_path
            const imagePath = selected.image_path && images[selected.image_path] ? selected.image_path : product?.approved_image_path && images[product.approved_image_path] ? product.approved_image_path : path
            const imageUrl = imagePath ? images[imagePath] : ''
            return imageUrl && imagePath ? <img className="detail-image" src={imageUrl} alt={selected.name} decoding="async" onError={() => setImages((current) => ({ ...current, [imagePath]: '' }))} /> : null
          })()}
          <dl className="detail-list">
            <div><dt>{t('description')}</dt><dd>{selected.description || t('notProvided')}</dd></div>
            <div><dt>{t('barcode')}</dt><dd>{selected.barcode || t('notProvided')}</dd></div>
            <div><dt>{t('presentation')}</dt><dd>{t(selected.presentation)}</dd></div>
            <div><dt>{t('productType')}</dt><dd>{selected.product_type || t('notProvided')}</dd></div>
            <div><dt>{t('model')}</dt><dd>{selected.model || t('notProvided')}</dd></div>
            <div><dt>{t('color')}</dt><dd>{selected.color || t('notProvided')}</dd></div>
            <div><dt>{t('registeredAt')}</dt><dd>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(selected.created_at))}</dd></div>
            <div><dt>{t('expiryDate')}</dt><dd>{selected.expiry_date ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(`${selected.expiry_date}T12:00:00`)) : t('notApplicable')}</dd></div>
            <div><dt>{t('minimumQuantity')}</dt><dd>{selected.min_quantity}</dd></div>
          </dl>
          <form className="edit-item-form" onSubmit={saveEdit}>
            <label>{t('name')}<input name="name" defaultValue={selected.name} required maxLength={160} /></label>
            <label>{t('description')}<textarea name="description" defaultValue={selected.description} rows={3} maxLength={2000} /></label>
            <label>{t('barcode')}<input name="barcode" defaultValue={selected.barcode ?? ''} maxLength={128} /></label>
            <div className="form-row"><label>{t('productType')}<input name="product_type" defaultValue={selected.product_type} maxLength={120} /></label><label>{t('model')}<input name="model" defaultValue={selected.model} maxLength={120} /></label></div>
            <label>{t('color')}<input name="color" defaultValue={selected.color} maxLength={80} /></label>
            <CategoryPicker categories={categories} value={selected.category_ids} onChange={(category_ids) => setSelected({ ...selected, category_ids })} label={t('categories')} />
            <div className="form-row"><label>{t('brand')}<select name="brand_id" defaultValue={selected.brand_id ?? ''}><option value="">{t('chooseBrand')}</option>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label><label>{t('presentation')}<select name="presentation" defaultValue={selected.presentation}><option value="individual">{t('individual')}</option><option value="set">{t('set')}</option><option value="box">{t('box')}</option></select></label></div>
            <div className="form-row"><label>{t('quantity')}<input name="quantity" type="number" min="0" defaultValue={selected.quantity} required /></label><label>{t('minimumQuantity')}<input name="min_quantity" type="number" min="0" defaultValue={selected.min_quantity} required /></label></div>
            <div className="form-row"><label>{t('expiryDate')}<input name="expiry_date" type="date" defaultValue={selected.expiry_date ?? ''} /></label><label>{t('status')}<select name="status" defaultValue={selected.status}><option value="new">{t('new')}</option><option value="opened">{t('opened')}</option><option value="used">{t('used')}</option><option value="defective">{t('defective')}</option><option value="missing">{t('missing')}</option></select></label></div>
            <label>{t('uploadImage')}<input name="edit_image" type="file" accept="image/jpeg,image/png,image/webp" /><span className="field-hint">{t('approvedImageHint')}</span></label>
            {selected.image_path && <label className="checkbox-label"><input type="checkbox" name="remove_custom_image" />{t('removeCustomImage')}</label>}
            <div className="quantity-controls"><span>{t('adjustQuantity')}</span><button type="button" disabled={busy || selected.quantity === 0} onClick={() => void changeQuantity(selected, -1)} aria-label={t('removeOne')}>−</button><strong>{t('quantityPresentation', { count: selected.quantity, presentation: t(selected.presentation) })}</strong><button type="button" disabled={busy} onClick={() => void changeQuantity(selected, 1)} aria-label={t('addOne')}>+</button></div>
            <div className="dialog-actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => void removeItem(selected)}>{t('delete')}</button><button className="primary-button" type="submit" disabled={busy}>{busy ? t('saving') : t('saveChanges')}</button></div>
          </form>
        </section>
      </div>}
    </section>
  )
}
