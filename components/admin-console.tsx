'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'

type Category = { id: string; slug: string; name_en: string; name_es: string; color_hex: string; is_active: boolean; sort_order: number }
type Brand = { id: string; name: string }
type Product = { id: string; name: string; description: string; barcode: string | null; category_id: string | null; category_ids: string[]; brand_id: string | null; approved_image_path: string | null; is_approved: boolean; presentation: 'individual' | 'set' | 'box'; sourceInventoryItemId?: string }
type User = { id: string; email: string | null; full_name: string; clinic_name: string; status: string; created_at: string }
type Clinic = { id: string; name: string }
type ClinicItem = { id: string; clinic_id: string; owner_id: string; product_id: string | null; name: string; description: string; barcode: string | null; category_id: string | null; category_ids: string[]; brand_id: string | null; image_path: string | null; presentation: 'individual' | 'set' | 'box'; quantity: number; owner_name: string }
type Stats = { users: number; clinics: number; items: number; products: number; categories: number; brands: number; reports: number }

const emptyStats: Stats = { users: 0, clinics: 0, items: 0, products: 0, categories: 0, brands: 0, reports: 0 }

export function AdminConsole() {
  const t = useTranslations()
  const locale = useLocale()
  const supabase = useMemo(() => createClient(), [])
  const [stats, setStats] = useState(emptyStats)
  const [categories, setCategories] = useState<Category[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [clinicItems, setClinicItems] = useState<ClinicItem[]>([])
  const [tab, setTab] = useState<'overview' | 'clinics' | 'catalog' | 'users'>('overview')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [adminLookupBusy, setAdminLookupBusy] = useState(false)
  const [adminLookupError, setAdminLookupError] = useState('')
  const [adminLookupSources, setAdminLookupSources] = useState<{ title: string; url: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setError('')
    const [
      { count: userCount, error: userError },
      { count: clinicCount, error: clinicError },
      { count: itemCount, error: itemError },
      { count: productCount, error: productError },
      { count: categoryCount, error: categoryError },
      { count: brandCount, error: brandError },
      { count: reportCount, error: reportError },
      { data: categoryRows, error: categoriesError },
      { data: brandRows, error: brandsError },
      { data: productRows, error: productsError },
      { data: userRows, error: usersError },
      { data: clinicRows, error: clinicsError },
      { data: clinicItemRows, error: clinicItemsError },
    ] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('clinics').select('id', { count: 'exact', head: true }),
      supabase.from('inventory_items').select('id', { count: 'exact', head: true }),
      supabase.from('catalog_products').select('id', { count: 'exact', head: true }),
      supabase.from('categories').select('id', { count: 'exact', head: true }),
      supabase.from('brands').select('id', { count: 'exact', head: true }),
      supabase.from('support_reports').select('id', { count: 'exact', head: true }),
      supabase.from('categories').select('id,slug,name_en,name_es,color_hex,is_active,sort_order').order('sort_order'),
      supabase.from('brands').select('id,name').order('name'),
      supabase.from('catalog_products').select('id,name,description,barcode,category_id,brand_id,approved_image_path,is_approved,presentation').order('name'),
      supabase.from('profiles').select('id,email,full_name,clinic_name,status,created_at').order('created_at', { ascending: false }).limit(100),
      supabase.from('clinics').select('id,name').order('name'),
      supabase.from('inventory_items').select('id,clinic_id,owner_id,product_id,name,description,barcode,category_id,brand_id,image_path,presentation,quantity').order('name'),
    ])
    const productIds = (productRows ?? []).map((product) => product.id)
    const itemIds = (clinicItemRows ?? []).map((item) => item.id)
    const ownerIds = [...new Set((clinicItemRows ?? []).map((item) => item.owner_id))]
    const [
      { data: productCategoryRows, error: productCategoriesError },
      { data: itemCategoryRows, error: itemCategoriesError },
      { data: ownerRows, error: ownersError },
    ] = await Promise.all([
      productIds.length
      ? await supabase.from('catalog_product_categories').select('product_id,category_id').in('product_id', productIds)
      : Promise.resolve({ data: [], error: null }),
      itemIds.length
        ? supabase.from('inventory_item_categories').select('item_id,category_id').in('item_id', itemIds)
        : Promise.resolve({ data: [], error: null }),
      ownerIds.length
        ? supabase.from('profiles').select('id,full_name,email').in('id', ownerIds)
        : Promise.resolve({ data: [], error: null }),
    ])
    const failure = userError || clinicError || itemError || productError || categoryError || brandError || reportError || categoriesError || brandsError || productsError || usersError || clinicsError || clinicItemsError || productCategoriesError || itemCategoriesError || ownersError
    if (failure) { setError(failure.message); return }
    setStats({ users: userCount ?? 0, clinics: clinicCount ?? 0, items: itemCount ?? 0, products: productCount ?? 0, categories: categoryCount ?? 0, brands: brandCount ?? 0, reports: reportCount ?? 0 })
    setCategories((categoryRows ?? []) as Category[])
    setBrands((brandRows ?? []) as Brand[])
    const categoryIdsByProduct = new Map<string, string[]>()
    for (const row of productCategoryRows ?? []) {
      categoryIdsByProduct.set(row.product_id, [...(categoryIdsByProduct.get(row.product_id) ?? []), row.category_id])
    }
    setProducts(((productRows ?? []) as Omit<Product, 'category_ids'>[]).map((product) => ({
      ...product,
      category_ids: categoryIdsByProduct.get(product.id) ?? (product.category_id ? [product.category_id] : []),
    })))
    setUsers((userRows ?? []) as User[])
    setClinics((clinicRows ?? []) as Clinic[])
    const categoryIdsByItem = new Map<string, string[]>()
    for (const row of itemCategoryRows ?? []) {
      categoryIdsByItem.set(row.item_id, [...(categoryIdsByItem.get(row.item_id) ?? []), row.category_id])
    }
    const ownerById = new Map((ownerRows ?? []).map((owner) => [owner.id, owner.full_name || owner.email || '']))
    setClinicItems(((clinicItemRows ?? []) as Omit<ClinicItem, 'category_ids' | 'owner_name'>[]).map((item) => ({
      ...item,
      category_ids: categoryIdsByItem.get(item.id) ?? (item.category_id ? [item.category_id] : []),
      owner_name: ownerById.get(item.owner_id) || '',
    })))
  }, [supabase])

  useEffect(() => { void load() }, [load])

  async function searchAdminProduct(formElement: HTMLFormElement) {
    const form = new FormData(formElement)
    const name = String(form.get('name') ?? '').trim()
    const barcode = String(form.get('barcode') ?? '').trim()
    if (!name && !barcode) {
      setAdminLookupError(t('adminAiSearchPrompt'))
      return
    }
    setAdminLookupBusy(true)
    setAdminLookupError('')
    setAdminLookupSources([])
    const request = new FormData()
    request.set('query', name)
    request.set('barcode', barcode)
    try {
      const response = await fetch('/api/product-assist', { method: 'POST', body: request })
      const result = await response.json() as {
        error?: string
        source?: 'catalog' | 'ai' | 'exa'
        product?: Product
        suggestion?: { name: string; description: string; barcode: string | null; brand: string | null; category_slugs: string[]; presentation: Product['presentation'] }
        sources?: { title: string; url: string }[]
      }
      if (!response.ok) {
        setAdminLookupError(result.error || t('productLookupFailed'))
        return
      }
      setAdminLookupSources(result.sources ?? [])
      if (result.source === 'catalog' && result.product) {
        setSelectedProduct({ ...result.product, is_approved: result.product.is_approved ?? true })
        return
      }
      if ((result.source === 'ai' || result.source === 'exa') && result.suggestion) {
        const suggestion = result.suggestion
        const categoryIds = suggestion.category_slugs.flatMap((slug) => {
          const category = categories.find((value) => value.slug === slug)
          return category ? [category.id] : []
        })
        setSelectedProduct({
          id: '',
          name: suggestion.name,
          description: suggestion.description,
          barcode: suggestion.barcode,
          category_id: categoryIds[0] ?? null,
          category_ids: categoryIds,
          brand_id: brands.find((brand) => brand.name.toLocaleLowerCase() === suggestion.brand?.toLocaleLowerCase())?.id ?? null,
          approved_image_path: null,
          is_approved: false,
          presentation: suggestion.presentation,
          sourceInventoryItemId: selectedProduct?.sourceInventoryItemId,
        })
        return
      }
      setAdminLookupError(t('productLookupFailed'))
    } catch (error) {
      setAdminLookupError(error instanceof Error ? error.message : t('productLookupFailed'))
    } finally {
      setAdminLookupBusy(false)
    }
  }

  function reviewClinicItem(item: ClinicItem) {
    setSelectedProduct({
      id: '',
      name: item.name,
      description: item.description,
      barcode: item.barcode,
      category_id: item.category_id,
      category_ids: item.category_ids,
      brand_id: item.brand_id,
      approved_image_path: null,
      is_approved: false,
      presentation: item.presentation,
      sourceInventoryItemId: item.product_id ? undefined : item.id,
    })
    setAdminLookupSources([])
    setAdminLookupError('')
    setTab('catalog')
  }

  async function saveProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setError(''); setNotice('')
    const form = new FormData(event.currentTarget)
    const fileValue = form.get('image')
    const file = fileValue instanceof File && fileValue.size > 0 ? fileValue : null
    let imagePath = selectedProduct?.approved_image_path ?? null
    if (file && file.size > 0) {
      if (file.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        setBusy(false); setError(t('invalidImage')); return
      }
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
      imagePath = `catalog/${crypto.randomUUID()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('inventory-images').upload(imagePath, file, { contentType: file.type })
      if (uploadError) { setBusy(false); setError(uploadError.message); return }
    }
    const categoryIds = [...new Set(form.getAll('category_ids').map(String).filter(Boolean))]
    const values = {
      name: String(form.get('name')).trim(),
      description: String(form.get('description')).trim(),
      barcode: String(form.get('barcode')).trim() || null,
      category_id: categoryIds[0] || null,
      brand_id: String(form.get('brand_id') || '') || null,
      presentation: String(form.get('presentation') || 'individual') as Product['presentation'],
      approved_image_path: imagePath,
      is_approved: form.get('is_approved') === 'on',
    }
    const result = selectedProduct?.id
      ? await supabase.from('catalog_products').update(values).eq('id', selectedProduct.id).select('id').single()
      : await supabase.from('catalog_products').insert(values).select('id').single()
    if (result.error) { setBusy(false); setError(result.error.message); return }
    const { error: categoryError } = await supabase.rpc('set_catalog_product_categories', {
      target_product: result.data.id,
      target_categories: categoryIds,
    })
    if (categoryError) { setBusy(false); setError(categoryError.message); return }
    if (selectedProduct?.sourceInventoryItemId) {
      const { error: linkError } = await supabase.from('inventory_items').update({ product_id: result.data.id }).eq('id', selectedProduct.sourceInventoryItemId)
      if (linkError) {
        setSelectedProduct({ ...selectedProduct, id: result.data.id })
        setBusy(false)
        setError(`${t('catalogProductSaved')} ${t('catalogLinkFailed')}: ${linkError.message}`)
        return
      }
    }
    setBusy(false)
    setSelectedProduct(null); setNotice(t('catalogProductSaved'))
    await load()
  }

  async function deleteProduct(product: Product) {
    if (!window.confirm(t('confirmDeleteProduct', { name: product.name }))) return
    const { error: deleteError } = await supabase.from('catalog_products').delete().eq('id', product.id)
    if (deleteError) { setError(deleteError.message); return }
    await load()
  }

  async function addCategory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const nameEn = String(form.get('name_en')).trim()
    const nameEs = String(form.get('name_es')).trim()
    const slug = String(form.get('slug')).trim().toLowerCase()
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      setError(t('invalidCategorySlug'))
      return
    }
    const { error: insertError } = await supabase.from('categories').insert({
      slug,
      name_en: nameEn, name_es: nameEs, color_hex: String(form.get('color_hex')), sort_order: Number(form.get('sort_order') || 0),
    })
    if (insertError) { setError(insertError.message); return }
    formElement.reset()
    await load()
  }

  async function editCategory(event: React.FormEvent<HTMLFormElement>, category: Category) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const slug = String(form.get('slug')).trim().toLowerCase()
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      setError(t('invalidCategorySlug'))
      return
    }
    await updateCategory(category, {
      name_en: String(form.get('name_en')).trim(),
      name_es: String(form.get('name_es')).trim(),
      slug,
      color_hex: String(form.get('color_hex')),
      sort_order: Number(form.get('sort_order')),
    })
  }

  async function updateCategory(category: Category, values: Partial<Category>) {
    const { error: updateError } = await supabase.from('categories').update(values).eq('id', category.id)
    if (updateError) { setError(updateError.message); return }
    await load()
  }

  async function deleteCategory(category: Category) {
    if (!window.confirm(t('confirmDeleteCategory', { name: locale === 'es' ? category.name_es : category.name_en }))) return
    const { error: deleteError } = await supabase.from('categories').delete().eq('id', category.id)
    if (deleteError) { setError(deleteError.message); return }
    await load()
  }

  async function deleteBrand(brand: Brand) {
    if (!window.confirm(t('confirmDeleteBrand', { name: brand.name }))) return
    const { error: deleteError } = await supabase.from('brands').delete().eq('id', brand.id)
    if (deleteError) { setError(deleteError.message); return }
    await load()
  }

  async function addBrand(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const { error: insertError } = await supabase.from('brands').insert({ name: String(form.get('name')).trim() })
    if (insertError) { setError(insertError.message); return }
    formElement.reset()
    await load()
  }

  async function editBrand(event: React.FormEvent<HTMLFormElement>, brand: Brand) {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get('name')).trim()
    const { error: updateError } = await supabase.from('brands').update({ name }).eq('id', brand.id)
    if (updateError) { setError(updateError.message); return }
    await load()
  }

  async function toggleUser(user: User) {
    const suspended = user.status !== 'suspended'
    if (!window.confirm(t(suspended ? 'confirmSuspendUser' : 'confirmReactivateUser', { name: user.email || user.full_name }))) return
    const { error: suspensionError } = await supabase.rpc('set_user_suspension', { target_user: user.id, suspend: suspended })
    if (suspensionError) { setError(suspensionError.message); return }
    await load()
  }

  return <section className="admin-content">
    <div className="page-heading admin-heading"><div><p className="eyebrow">{t('admin')}</p><h1>{t('adminTitle')}</h1><p className="subtle">{t('adminDescription')}</p></div><Link className="secondary-button" href="/support">{t('manageReports')} · {stats.reports}</Link></div>
    <div className="admin-tabs" role="tablist" aria-label={t('adminSections')}>
      {(['overview', 'clinics', 'catalog', 'users'] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={tab === value} className={tab === value ? 'admin-tab selected' : 'admin-tab'} onClick={() => setTab(value)}>{t(value === 'overview' ? 'overview' : value === 'clinics' ? 'clinics' : value === 'catalog' ? 'catalog' : 'users')}</button>)}
    </div>
    {tab === 'overview' && <div className="admin-stats">{([
      ['users', stats.users], ['clinics', stats.clinics], ['inventoryItems', stats.items], ['catalogProducts', stats.products], ['categories', stats.categories], ['brands', stats.brands], ['reports', stats.reports],
    ] as const).map(([label, count]) => <article className="card admin-stat" key={label}><span>{t(label)}</span><strong>{count}</strong></article>)}</div>}
    {tab === 'clinics' && <div className="clinic-review-list">{clinics.map((clinic) => {
      const items = clinicItems.filter((item) => item.clinic_id === clinic.id)
      return <section className="card admin-section" key={clinic.id}>
        <div className="section-heading"><div><h2>{clinic.name}</h2><p className="subtle">{t('clinicProductsCount', { count: items.length })}</p></div></div>
        {items.length === 0 ? <p className="subtle">{t('noClinicProducts')}</p> : <div className="table-wrap"><table><thead><tr><th>{t('name')}</th><th>{t('barcode')}</th><th>{t('brand')}</th><th>{t('quantity')}</th><th>{t('catalog')}</th><th>{t('actions')}</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}>
          <td><strong>{item.name}</strong><br /><span className="field-hint">{item.owner_name || t('unnamedUser')}</span></td>
          <td>{item.barcode || '—'}</td>
          <td>{brands.find((brand) => brand.id === item.brand_id)?.name || '—'}</td>
          <td>{item.quantity}</td>
          <td>{item.product_id ? t('linkedToCatalog') : t('pendingCatalogReview')}</td>
          <td><button className="text-button" type="button" onClick={() => reviewClinicItem(item)}>{item.product_id ? t('viewProduct') : t('addToCatalog')}</button></td>
        </tr>)}</tbody></table></div>}
      </section>
    })}</div>}
    {tab === 'catalog' && <div className="admin-management">
      <section className="card admin-section">
        <div className="section-heading"><div><h2>{t('globalProducts')}</h2><p className="subtle">{t('catalogAdminDescription')}</p></div><button type="button" className="primary-button" onClick={() => setSelectedProduct({ id: '', name: '', description: '', barcode: null, category_id: null, category_ids: [], brand_id: null, approved_image_path: null, is_approved: false, presentation: 'individual' })}>{t('createProduct')}</button></div>
        {selectedProduct && <form key={`admin-product-${selectedProduct.id}-${selectedProduct.name}-${selectedProduct.barcode ?? ''}`} className="admin-product-form" onSubmit={(event) => void saveProduct(event)}>
          <h3>{selectedProduct.id ? t('editProduct') : t('createProduct')}</h3>
          <div className="form-grid">
            <label>{t('name')}<input name="name" defaultValue={selectedProduct.name} required maxLength={160} key={`pname-${selectedProduct.id}`} /></label>
            <label>{t('barcode')}<input name="barcode" defaultValue={selectedProduct.barcode ?? ''} maxLength={128} key={`pbarcode-${selectedProduct.id}`} /></label>
            <label>{t('categories')}<select name="category_ids" multiple value={selectedProduct.category_ids} onChange={(event) => setSelectedProduct({ ...selectedProduct, category_ids: [...event.target.selectedOptions].map((option) => option.value) })} size={Math.min(categories.length, 5)} aria-describedby="product-category-hint">{categories.map((category) => <option key={category.id} value={category.id}>{locale === 'es' ? category.name_es : category.name_en}</option>)}</select><span id="product-category-hint" className="field-hint">{t('selectMultipleCategories')}</span></label>
            <label>{t('brand')}<select name="brand_id" defaultValue={selectedProduct.brand_id ?? ''} key={`pbrand-${selectedProduct.id}`}><option value="">{t('chooseBrand')}</option>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>
            <label>{t('presentation')}<select name="presentation" defaultValue={selectedProduct.presentation} key={`ppresentation-${selectedProduct.id}`}><option value="individual">{t('individual')}</option><option value="set">{t('set')}</option><option value="box">{t('box')}</option></select></label>
            <label className="field-wide">{t('description')}<textarea name="description" rows={3} defaultValue={selectedProduct.description} key={`pdescription-${selectedProduct.id}`} /></label>
            <label>{t('approvedProductImage')}<input type="file" name="image" accept="image/jpeg,image/png,image/webp" /></label>
            <label className="checkbox-label"><input type="checkbox" name="is_approved" defaultChecked={selectedProduct.is_approved} key={`papproved-${selectedProduct.id}`} />{t('approvedForClinics')}</label>
          </div>
          <div className="admin-ai-tools">
            <button type="button" className="secondary-button" disabled={adminLookupBusy} onClick={(event) => {
              const formElement = event.currentTarget.form
              if (formElement) void searchAdminProduct(formElement)
            }}>{adminLookupBusy ? t('searchingWithAi') : t('adminAiSearch')}</button>
            <span className="field-hint">{t('adminAiSearchHint')}</span>
            {adminLookupError && <p role="alert" className="error-message">{adminLookupError}</p>}
            {adminLookupSources.length > 0 && <ul className="exa-sources">{adminLookupSources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul>}
          </div>
          <div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setSelectedProduct(null)}>{t('cancel')}</button><button className="primary-button" disabled={busy}>{busy ? t('saving') : t('saveChanges')}</button></div>
        </form>}
        <div className="table-wrap"><table><thead><tr><th>{t('name')}</th><th>{t('barcode')}</th><th>{t('brand')}</th><th>{t('approval')}</th><th>{t('actions')}</th></tr></thead><tbody>{products.map((product) => <tr key={product.id}><td>{product.name}</td><td>{product.barcode || '—'}</td><td>{brands.find((brand) => brand.id === product.brand_id)?.name || '—'}</td><td><span className={`status-badge ${product.is_approved ? 'status-new' : 'status-missing'}`}>{t(product.is_approved ? 'approved' : 'pendingApproval')}</span></td><td><button className="text-button" type="button" onClick={() => setSelectedProduct(product)}>{t('edit')}</button><button className="text-button danger-text" type="button" onClick={() => void deleteProduct(product)}>{t('delete')}</button></td></tr>)}</tbody></table></div>
      </section>
      <section className="card admin-section">
        <div className="section-heading"><div><h2>{t('manageCategories')}</h2><p className="subtle">{t('categoryAdminDescription')}</p></div></div>
        <form className="inline-admin-form" onSubmit={(event) => void addCategory(event)}><input name="name_en" placeholder={t('nameEnglish')} required /><input name="name_es" placeholder={t('nameSpanish')} required /><input name="slug" placeholder={t('slug')} required /><input name="color_hex" type="color" defaultValue="#9CC8F5" aria-label={t('categoryColor')} /><input name="sort_order" type="number" defaultValue="0" aria-label={t('sortOrder')} /><button className="secondary-button">{t('createCategory')}</button></form>
        <div className="table-wrap"><table><thead><tr><th>{t('nameEnglish')}</th><th>{t('nameSpanish')}</th><th>{t('slug')}</th><th>{t('categoryColor')}</th><th>{t('visibility')}</th><th>{t('actions')}</th></tr></thead><tbody>{categories.map((category) => <tr key={category.id}><td colSpan={6}><form className="category-edit-form" onSubmit={(event) => void editCategory(event, category)}><input name="name_en" defaultValue={category.name_en} required maxLength={80} aria-label={t('nameEnglish')} /><input name="name_es" defaultValue={category.name_es} required maxLength={80} aria-label={t('nameSpanish')} /><input name="slug" defaultValue={category.slug} required aria-label={t('slug')} /><input name="color_hex" type="color" defaultValue={category.color_hex} aria-label={t('categoryColor')} /><input name="sort_order" type="number" defaultValue={category.sort_order} aria-label={t('sortOrder')} /><button className="text-button" type="submit">{t('saveChanges')}</button><button className="text-button" type="button" onClick={() => void updateCategory(category, { is_active: !category.is_active })}>{t(category.is_active ? 'deactivate' : 'activate')}</button><button className="text-button danger-text" type="button" onClick={() => void deleteCategory(category)}>{t('delete')}</button></form></td></tr>)}</tbody></table></div>
      </section>
      <section className="card admin-section">
        <h2>{t('manageBrands')}</h2><form className="inline-admin-form" onSubmit={(event) => void addBrand(event)}><input name="name" placeholder={t('brandName')} required maxLength={120} /><button className="secondary-button">{t('createBrand')}</button></form>
        <ul className="brand-list">{brands.map((brand) => <li key={brand.id}><form className="brand-edit-form" onSubmit={(event) => void editBrand(event, brand)}><input name="name" defaultValue={brand.name} required maxLength={120} aria-label={t('brandName')} /><button className="text-button" type="submit">{t('saveChanges')}</button><button className="text-button danger-text" type="button" onClick={() => void deleteBrand(brand)}>{t('delete')}</button></form></li>)}</ul>
      </section>
    </div>}
    {tab === 'users' && <section className="card admin-section"><h2>{t('users')}</h2><p className="subtle">{t('userAdminDescription')}</p><div className="table-wrap"><table><thead><tr><th>{t('user')}</th><th>{t('clinic')}</th><th>{t('registeredAt')}</th><th>{t('status')}</th><th>{t('actions')}</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><strong>{user.full_name || t('unnamedUser')}</strong><br /><span className="field-hint">{user.email}</span></td><td>{user.clinic_name || '—'}</td><td>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(user.created_at))}</td><td>{t(user.status === 'suspended' ? 'suspended' : 'active')}</td><td><button className="text-button" type="button" onClick={() => void toggleUser(user)}>{t(user.status === 'suspended' ? 'reactivate' : 'suspend')}</button></td></tr>)}</tbody></table></div></section>}
    {error && <p role="alert" className="error-message">{error}</p>}
    {notice && <p role="status" className="success-message">{notice}</p>}
  </section>
}
