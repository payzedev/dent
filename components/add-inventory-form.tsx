'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { BarcodeScanner } from '@/components/barcode-scanner'
import { ScanIcon, SearchIcon } from '@/components/icons'

type Category = { id: string; slug: string; name_en: string; name_es: string }
type Brand = { id: string; name: string }
type CatalogProduct = {
  id: string
  name: string
  description: string
  barcode: string | null
  category_id: string | null
  category_ids: string[]
  brand_id: string | null
  approved_image_path: string | null
  presentation: 'individual' | 'set' | 'box'
}
type ProductSuggestion = {
  name: string
  description: string
  barcode: string | null
  brand: string | null
  category_slugs: string[]
  presentation: 'individual' | 'set' | 'box'
}
type ProductCandidate =
  | { source: 'catalog'; product: CatalogProduct; imageUrl: string | null }
  | { source: 'ai'; suggestion: ProductSuggestion; sources?: { title: string; url: string }[] }
  | { source: 'exa'; suggestion: ProductSuggestion; sources: { title: string; url: string }[] }
  | { source: 'pharmacy'; suggestion: ProductSuggestion; sources: { title: string; url: string }[]; imageUrl: string | null }

type PharmacyResult = {
  pharmacy: 'Farmaciasaas' | 'Farmatodo'
  productUrl: string
  found: boolean
  name: string | null
  description: string | null
  imageUrl: string | null
  brand?: string | null
}

export function AddInventoryForm() {
  const t = useTranslations()
  const locale = useLocale()
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [clinicId, setClinicId] = useState('')
  const [userId, setUserId] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CatalogProduct[]>([])
  const [product, setProduct] = useState<CatalogProduct | null>(null)
  const [categoryIds, setCategoryIds] = useState<string[]>([])
  const [barcode, setBarcode] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)
  const [candidate, setCandidate] = useState<ProductCandidate | null>(null)
  const [aiPrefill, setAiPrefill] = useState<ProductSuggestion | null>(null)
  const [lookupBusy, setLookupBusy] = useState(false)
  const [lookupError, setLookupError] = useState('')
  const [lookupStep, setLookupStep] = useState<'catalog' | 'pharmacy' | 'ai' | null>(null)
  const [catalogImageUrls, setCatalogImageUrls] = useState<Record<string, string>>({})
  const [photoPreview, setPhotoPreview] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    async function initialize() {
      const [{ data: { user }, error: authError }, { data: categoryRows, error: categoryError }, { data: brandRows, error: brandError }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from('categories').select('id,slug,name_en,name_es').eq('is_active', true).order('sort_order'),
        supabase.from('brands').select('id,name').order('name'),
      ])
      if (cancelled) return
      const failure = authError || categoryError || brandError
      if (failure) { setError(failure.message); return }
      if (!user) { setError(t('sessionRequired')); return }
      const { data: profile, error: profileError } = await supabase.from('profiles').select('primary_clinic_id').eq('id', user.id).single()
      if (cancelled) return
      if (profileError) { setError(profileError.message); return }
      if (!profile?.primary_clinic_id) { setError(t('clinicNotConfigured')); return }
      setClinicId(profile.primary_clinic_id)
      setUserId(user.id)
      setCategories((categoryRows ?? []) as Category[])
      setBrands((brandRows ?? []) as Brand[])
    }
    void initialize()
    return () => { cancelled = true }
  }, [supabase, t])

  useEffect(() => {
    if (!photo) {
      setPhotoPreview('')
      return
    }
    const previewUrl = URL.createObjectURL(photo)
    setPhotoPreview(previewUrl)
    return () => URL.revokeObjectURL(previewUrl)
  }, [photo])

  useEffect(() => {
    const term = query.trim()
    if (product || term.length < 2) { setResults([]); return }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      const { data, error: searchError } = await supabase.rpc('search_catalog', { search_term: term, result_limit: 8 })
      if (cancelled) return
      if (searchError) { setError(searchError.message); return }
      const products = (data ?? []) as CatalogProduct[]
      setResults(products)
      const imageEntries = await Promise.all(products.flatMap((product) => product.approved_image_path
        ? [supabase.storage.from('inventory-images').createSignedUrl(product.approved_image_path, 3600).then(({ data: image, error: imageError }) => {
          if (imageError) {
            console.error('Could not load a shared catalog product photo', imageError.message)
            return [product.id, ''] as const
          }
          return [product.id, image.signedUrl] as const
        })]
        : []))
      if (!cancelled) setCatalogImageUrls(Object.fromEntries(imageEntries))
    }, 250)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [query, product, supabase])

  function chooseProduct(value: CatalogProduct) {
    setProduct(value)
    setAiPrefill(null)
    setQuery(value.name)
    setBarcode(value.barcode ?? '')
    setCategoryIds(value.category_ids?.length ? value.category_ids : value.category_id ? [value.category_id] : [])
    setResults([])
  }

  const handleBarcodeDetected = useCallback((value: string) => {
    setBarcode(value)
    setQuery(value)
    setProduct(null)
    setAiPrefill(null)
    setCategoryIds([])
    setScannerOpen(false)
  }, [])

  async function searchProductAssist() {
    setLookupBusy(true)
    setLookupError('')
    setCandidate(null)
    const searchTerm = barcode.trim() || query.trim()
    const inferredBarcode = barcode.trim() || (/^\d{8,14}$/.test(query.trim()) ? query.trim() : '')
    try {
      setLookupStep('catalog')
      if (searchTerm) {
        const { data, error: catalogError } = await supabase.rpc('search_catalog', { search_term: searchTerm, result_limit: 8 })
        if (catalogError) throw new Error(catalogError.message)
        const products = (data ?? []) as CatalogProduct[]
        const match = products.find((item) => barcode.trim() && item.barcode?.trim() === barcode.trim()) ?? products[0]
        if (match) {
          let imageUrl: string | null = catalogImageUrls[match.id] || null
          if (match.approved_image_path && !imageUrl) {
            const { data: image, error: imageError } = await supabase.storage.from('inventory-images').createSignedUrl(match.approved_image_path, 3600)
            if (imageError) console.error('Could not load a shared catalog product photo', imageError.message)
            else imageUrl = image.signedUrl
          }
          setCandidate({ source: 'catalog', product: match, imageUrl })
          return
        }
      }

      if (/^[\da-zA-Z-]{1,128}$/.test(inferredBarcode)) {
        setLookupStep('pharmacy')
        try {
          const response = await fetch(`/api/pharmacy-search?barcode=${encodeURIComponent(inferredBarcode)}`)
          const result = await response.json() as { error?: string; results?: PharmacyResult[] }
          if (response.ok) {
            const pharmacyProduct = result.results?.find((item) => item.found && item.name)
            if (pharmacyProduct?.name) {
              setCandidate({
                source: 'pharmacy',
                suggestion: {
                  name: pharmacyProduct.name,
                  description: pharmacyProduct.description ?? '',
                  barcode: inferredBarcode,
                  brand: pharmacyProduct.brand ?? null,
                  category_slugs: [],
                  presentation: 'individual',
                },
                sources: [{ title: pharmacyProduct.pharmacy, url: pharmacyProduct.productUrl }],
                imageUrl: pharmacyProduct.imageUrl,
              })
              return
            }
          } else {
            console.error('Pharmacy catalog search failed', result.error || response.statusText)
          }
        } catch (error) {
          console.error('Pharmacy catalog search failed', error instanceof Error ? error.message : 'Unknown error')
        }
      }

      setLookupStep('ai')
      const form = new FormData()
      form.set('query', inferredBarcode ? '' : query.trim())
      form.set('barcode', inferredBarcode)
      if (photo) form.set('image', photo)
      const response = await fetch('/api/product-assist', { method: 'POST', body: form })
      const result = await response.json() as {
        error?: string
        source?: 'catalog' | 'ai' | 'exa'
        product?: CatalogProduct
        suggestion?: ProductSuggestion
        sources?: { title: string; url: string }[]
      }
      if (!response.ok) {
        throw new Error(result.error || t('productLookupFailed'))
      }
      if (result.source === 'catalog' && result.product) {
        const imagePath = result.product.approved_image_path
        let imageUrl: string | null = null
        if (imagePath) {
          const { data: image, error: imageError } = await supabase.storage.from('inventory-images').createSignedUrl(imagePath, 3600)
          if (imageError) console.error('Could not load a shared catalog product photo', imageError.message)
          else imageUrl = image.signedUrl
        }
        setCandidate({ source: 'catalog', product: result.product, imageUrl })
        return
      }
      if (result.source === 'ai' && result.suggestion) {
        setCandidate({ source: 'ai', suggestion: result.suggestion, sources: result.sources ?? [] })
        return
      }
      if (result.source === 'exa' && result.suggestion) {
        setCandidate({ source: 'exa', suggestion: result.suggestion, sources: result.sources ?? [] })
        return
      }
      throw new Error(t('productLookupFailed'))
    } catch (error) {
      setLookupError(error instanceof Error ? error.message : t('productLookupFailed'))
    } finally {
      setLookupBusy(false)
      setLookupStep(null)
    }
  }

  function selectPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    if (file && (file.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) {
      setError(t('invalidImage'))
      event.target.value = ''
      setPhoto(null)
      return
    }
    setError('')
    setPhoto(file)
  }

  function acceptCandidate() {
    if (!candidate) return
    if (candidate.source === 'catalog') {
      chooseProduct(candidate.product)
    } else {
      setProduct(null)
      setAiPrefill(candidate.suggestion)
      setQuery(candidate.suggestion.name)
      setBarcode(candidate.suggestion.barcode ?? barcode)
      setCategoryIds(candidate.suggestion.category_slugs.flatMap((slug) => {
        const category = categories.find((value) => value.slug === slug)
        return category ? [category.id] : []
      }))
    }
    setCandidate(null)
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') || product?.name || '').trim()
    const quantity = Number(form.get('quantity'))
    if (!name || !Number.isInteger(quantity) || quantity < 0) {
      setBusy(false)
      setError(t('invalidItemDetails'))
      return
    }

    if (!clinicId) {
      setBusy(false)
      setError(t('clinicNotConfigured'))
      return
    }

    let imagePath: string | null = null
    if (photo) {
      const extension = photo.type === 'image/png' ? 'png' : photo.type === 'image/webp' ? 'webp' : 'jpg'
      imagePath = `${clinicId}/${userId}/${crypto.randomUUID()}.${extension}`
      const { error: uploadError } = await supabase.storage.from('inventory-images').upload(imagePath, photo, { contentType: photo.type, upsert: false })
      if (uploadError) {
        setBusy(false)
        setError(uploadError.message)
        return
      }
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      if (imagePath) await supabase.storage.from('inventory-images').remove([imagePath])
      setBusy(false)
      setError(authError?.message || t('sessionRequired'))
      return
    }

    const selectedCategoryIds = [...new Set(form.getAll('category_ids').map(String).filter(Boolean))]
    const categoryId = selectedCategoryIds[0] || null
    const brandId = String(form.get('brand_id') || '') || product?.brand_id || null
    const { data: insertedItem, error: insertError } = await supabase.from('inventory_items').insert({
      clinic_id: clinicId,
      owner_id: user.id,
      product_id: product?.id ?? null,
      name,
      description: String(form.get('description') || product?.description || '').trim(),
      barcode: String(form.get('barcode') || '').trim() || null,
      category_id: categoryId,
      brand_id: brandId,
      presentation: String(form.get('presentation') || 'individual'),
      quantity,
      min_quantity: Number(form.get('min_quantity') || 1),
      expiry_date: String(form.get('expiry_date') || '') || null,
      status: quantity === 0 ? 'missing' : 'new',
      image_path: imagePath,
    }).select('id').single()
    if (insertError) {
      if (imagePath) await supabase.storage.from('inventory-images').remove([imagePath])
      setBusy(false)
      setError(insertError.message)
      return
    }
    const { error: categoryError } = await supabase.rpc('set_inventory_item_categories', {
      target_item: insertedItem.id,
      target_categories: selectedCategoryIds,
    })
    if (categoryError) {
      const { error: rollbackError } = await supabase.from('inventory_items').delete().eq('id', insertedItem.id)
      if (rollbackError) {
        setBusy(false)
        setError(`${categoryError.message} ${rollbackError.message}`)
        return
      }
      if (imagePath) {
        const { error: cleanupError } = await supabase.storage.from('inventory-images').remove([imagePath])
        setBusy(false)
        setError(cleanupError ? `${categoryError.message} ${t('uploadedImageCleanupFailed')}: ${cleanupError.message}` : categoryError.message)
        return
      }
      setBusy(false)
      setError(categoryError.message)
      return
    }
    setBusy(false)
    setMessage(t('itemAdded'))
    router.push('/inventory')
    router.refresh()
  }

  return (
    <section className="form-page">
      <div className="page-heading"><div><p className="eyebrow">{t('inventory')}</p><h1>{t('addItem')}</h1><p className="subtle">{t('addItemDescription')}</p></div></div>
      <form className="card inventory-form" onSubmit={submit}>
        <div className="catalog-search">
          <label>{t('findCatalogProduct')}<span className="input-with-icon catalog-search-input"><SearchIcon /><input value={query} onChange={(event) => { setQuery(event.target.value); setProduct(null); setAiPrefill(null); setCategoryIds([]) }} placeholder={t('searchNameOrBarcode')} autoComplete="off" /><button type="button" className="scan-button" aria-label={t('scanBarcode')} title={t('scanBarcode')} onClick={() => setScannerOpen(true)}><ScanIcon size={20} /></button></span></label>
          <p className="field-hint">{t('catalogLookupHint')}</p>
          {results.length > 0 && <ul className="catalog-results">{results.map((result) => <li key={result.id}><button type="button" onClick={() => chooseProduct(result)}>{catalogImageUrls[result.id] ? <img src={catalogImageUrls[result.id]} alt="" onError={() => setCatalogImageUrls((current) => ({ ...current, [result.id]: '' }))} /> : <span className="catalog-result-image" aria-hidden="true">✳</span>}<span className="catalog-result-copy"><strong>{result.name}</strong><span>{result.barcode || t('noBarcode')}</span></span></button></li>)}</ul>}
          {(query.trim().length >= 2 || barcode.trim() || photo) && <button type="button" className="secondary-button ai-search-button" disabled={lookupBusy} onClick={() => void searchProductAssist()}>{lookupBusy ? t(lookupStep === 'catalog' ? 'searchingCatalog' : lookupStep === 'pharmacy' ? 'searchingPharmacies' : 'searchingWithAi') : t('searchCatalogPharmacyAi')}</button>}
          {lookupError && <p role="alert" className="error-message">{lookupError}</p>}
        </div>
        {product && <div className="catalog-selected" role="status">{catalogImageUrls[product.id] && <img src={catalogImageUrls[product.id]} alt={product.name} onError={() => setCatalogImageUrls((current) => ({ ...current, [product.id]: '' }))} />}<span>{t('catalogProductSelected', { name: product.name })}</span><button type="button" className="text-button" onClick={() => { setProduct(null); setQuery(''); setBarcode(''); setCategoryIds([]) }}>{t('clear')}</button></div>}
        <div className="form-grid">
          <label>{t('name')}<input name="name" required maxLength={160} defaultValue={product?.name ?? aiPrefill?.name ?? ''} key={`name-${product?.id ?? aiPrefill?.name ?? 'custom'}`} /></label>
          <label>{t('barcode')}<input name="barcode" maxLength={128} value={barcode} onChange={(event) => { setBarcode(event.target.value); setProduct(null); setAiPrefill(null) }} placeholder={t('barcodePlaceholder')} /></label>
          <label>{t('categories')}<select name="category_ids" multiple value={categoryIds} onChange={(event) => setCategoryIds([...event.target.selectedOptions].map((option) => option.value))} aria-describedby="category-selection-hint">{categories.map((category) => <option key={category.id} value={category.id}>{locale === 'es' ? category.name_es : category.name_en}</option>)}</select><span id="category-selection-hint" className="field-hint">{t('selectMultipleCategories')}</span></label>
          <label>{t('brand')}<select name="brand_id" defaultValue={product?.brand_id ?? brands.find((brand) => brand.name.toLocaleLowerCase() === aiPrefill?.brand?.toLocaleLowerCase())?.id ?? ''} key={`brand-${product?.id ?? aiPrefill?.name ?? 'custom'}`}><option value="">{t('chooseBrand')}</option>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>
          <label className="field-wide">{t('description')}<textarea name="description" rows={4} maxLength={2000} defaultValue={product?.description ?? aiPrefill?.description ?? ''} key={`description-${product?.id ?? aiPrefill?.name ?? 'custom'}`} /></label>
          <label>{t('presentation')}<select name="presentation" defaultValue={product?.presentation ?? aiPrefill?.presentation ?? 'individual'} key={`presentation-${product?.id ?? aiPrefill?.name ?? 'custom'}`}><option value="individual">{t('individual')}</option><option value="set">{t('set')}</option><option value="box">{t('box')}</option></select></label>
          <label>{t('quantity')}<input name="quantity" type="number" min="0" step="1" defaultValue="1" required /></label>
          <label>{t('minimumQuantity')}<input name="min_quantity" type="number" min="0" step="1" defaultValue="1" required /></label>
          <label>{t('expiryDate')}<input name="expiry_date" type="date" /></label>
          <div className="photo-picker field-wide">
            <label>{t('takePhoto')}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={selectPhoto} /></label>
            <label>{t('choosePhoto')}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={selectPhoto} /></label>
            <span className="field-hint">{t('approvedImageHint')}</span>
          </div>
        </div>
        {photo && <p className="field-hint">{t('photoLookupPrivacy')}</p>}
        {error && <p role="alert" className="error-message">{error}</p>}
        {message && <p role="status" className="success-message">{message}</p>}
        <div className="form-footer"><p className="field-hint">{t('expiryOptionalHint')}</p><button className="primary-button" type="submit" disabled={busy || !clinicId}>{busy ? t('saving') : t('saveItem')}</button></div>
      </form>
      {scannerOpen && <BarcodeScanner onDetected={handleBarcodeDetected} onClose={() => setScannerOpen(false)} />}
      {candidate && <div className="dialog-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setCandidate(null) }}>
        <section role="dialog" aria-modal="true" aria-labelledby="product-candidate-title" className="item-dialog card product-candidate-dialog">
          <h2 id="product-candidate-title">{t('confirmProduct')}</h2>
          <p className="subtle">{t(candidate.source === 'catalog' ? 'catalogVerifiedProduct' : candidate.source === 'pharmacy' ? 'pharmacyProductVerified' : candidate.source === 'exa' ? 'exaSuggestionDisclaimer' : 'aiSuggestionDisclaimer')}</p>
          {candidate.source === 'catalog' && (candidate.imageUrl || photoPreview) && <img className="detail-image" src={candidate.imageUrl || photoPreview} alt={candidate.imageUrl ? candidate.product.name : t('uploadedProductPhoto')} onError={() => {
            if (candidate.imageUrl) setCandidate({ ...candidate, imageUrl: null })
          }} />}
          {candidate.source === 'pharmacy' && candidate.imageUrl && <img className="detail-image" src={candidate.imageUrl} alt={candidate.suggestion.name} onError={() => setCandidate({ ...candidate, imageUrl: null })} />}
          {candidate.source !== 'catalog' && candidate.source !== 'pharmacy' && photoPreview && <img className="detail-image" src={photoPreview} alt={t('uploadedProductPhoto')} />}
          <dl className="detail-list">
            <div><dt>{t('name')}</dt><dd>{candidate.source === 'catalog' ? candidate.product.name : candidate.suggestion.name}</dd></div>
            <div><dt>{t('barcode')}</dt><dd>{(candidate.source === 'catalog' ? candidate.product.barcode : candidate.suggestion.barcode) || t('notProvided')}</dd></div>
            <div><dt>{t('description')}</dt><dd>{(candidate.source === 'catalog' ? candidate.product.description : candidate.suggestion.description) || t('notProvided')}</dd></div>
            <div><dt>{t('brand')}</dt><dd>{candidate.source === 'catalog'
              ? brands.find((brand) => brand.id === candidate.product.brand_id)?.name || t('notProvided')
              : candidate.suggestion.brand || t('notProvided')}</dd></div>
            <div><dt>{t('categories')}</dt><dd>{candidate.source === 'catalog'
              ? (candidate.product.category_ids ?? []).map((id) => {
                const category = categories.find((value) => value.id === id)
                return category ? locale === 'es' ? category.name_es : category.name_en : ''
              }).filter(Boolean).join(', ') || t('uncategorized')
              : candidate.suggestion.category_slugs.map((slug) => {
                const category = categories.find((value) => value.slug === slug)
                return category ? locale === 'es' ? category.name_es : category.name_en : ''
              }).filter(Boolean).join(', ') || t('uncategorized')}</dd></div>
            <div><dt>{t('presentation')}</dt><dd>{t(candidate.source === 'catalog' ? candidate.product.presentation : candidate.suggestion.presentation)}</dd></div>
          </dl>
          {candidate.source !== 'catalog' && (candidate.source === 'exa' ? candidate.sources : candidate.sources ?? []).length > 0 && <div className="exa-sources"><strong>{t('webSources')}</strong><ul>{(candidate.source === 'exa' ? candidate.sources : candidate.sources ?? []).map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul></div>}
          <div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setCandidate(null)}>{t('rejectProduct')}</button><button type="button" className="primary-button" onClick={acceptCandidate}>{t('confirmProduct')}</button></div>
        </section>
      </div>}
    </section>
  )
}
