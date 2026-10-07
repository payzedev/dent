'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { BarcodeScanner } from '@/components/barcode-scanner'
import { CategoryPicker } from '@/components/category-picker'
import { ScanIcon, SearchIcon } from '@/components/icons'

type Category = { id: string; slug: string; name_en: string; name_es: string; color_hex: string }
type Brand = { id: string; name: string; clinic_id: string | null }
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
  product_type?: string
  model?: string
  color?: string
}
type ProductSuggestion = {
  name: string
  description: string
  barcode: string | null
  brand: string | null
  product_type: string
  model: string
  color: string
  category_slugs: string[]
  presentation: 'individual' | 'set' | 'box'
}
type ProductCandidate =
  | { source: 'catalog'; product: CatalogProduct; imageUrl: string | null }
  | { source: 'ai' | 'exa' | 'pharmacy' | 'store'; suggestion: ProductSuggestion; sourceName: string; sources: { title: string; url: string }[]; imageUrl: string | null; score: number }

type PharmacyResult = {
  pharmacy: string
  productUrl: string
  found: boolean
  name: string | null
  description: string | null
  imageUrl: string | null
  brand?: string | null
  score: number
}
type StoreResult = { store: string; name: string; url: string; description: string; imageUrl: string | null; score: number }

function normalizeLookupKey(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/\s+/g, ' ').trim().slice(0, 160)
}

function candidateKey(candidate: ProductCandidate) {
  if (candidate.source === 'catalog') return `catalog:${candidate.product.id}`
  return `${candidate.source}:${normalizeLookupKey(candidate.suggestion.name)}`
    .toLocaleLowerCase().slice(0, 500)
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
  const [brandId, setBrandId] = useState('')
  const [newBrandName, setNewBrandName] = useState('')
  const [brandBusy, setBrandBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CatalogProduct[]>([])
  const [product, setProduct] = useState<CatalogProduct | null>(null)
  const [prefillVersion, setPrefillVersion] = useState(0)
  const [categoryIds, setCategoryIds] = useState<string[]>([])
  const [barcode, setBarcode] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)
  const [candidates, setCandidates] = useState<ProductCandidate[]>([])
  const [aiPrefill, setAiPrefill] = useState<ProductSuggestion | null>(null)
  const [lookupBusy, setLookupBusy] = useState(false)
  const [lookupError, setLookupError] = useState('')
  const [lookupStep, setLookupStep] = useState<'catalog' | 'pharmacy' | 'store' | 'ai' | null>(null)
  const [catalogImageUrls, setCatalogImageUrls] = useState<Record<string, string>>({})
  const [photoPreview, setPhotoPreview] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [activeLookupKey, setActiveLookupKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    async function initialize() {
      const [{ data: { user }, error: authError }, { data: categoryRows, error: categoryError }, { data: brandRows, error: brandError }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from('categories').select('id,slug,name_en,name_es,color_hex').eq('is_active', true).order('sort_order'),
        supabase.from('brands').select('id,name,clinic_id').order('name'),
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
      const imageEntries = products.flatMap((product) => product.approved_image_path
        ? [[product.id, `/api/inventory-image?path=${encodeURIComponent(product.approved_image_path)}&user=${encodeURIComponent(userId)}`] as const]
        : [])
      if (!cancelled) setCatalogImageUrls(Object.fromEntries(imageEntries))
    }, 250)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [query, product, supabase, userId])

  function chooseProduct(value: CatalogProduct) {
    setPrefillVersion((version) => version + 1)
    setProduct(value)
    setAiPrefill(null)
    setQuery(value.name)
    setBarcode(value.barcode ?? '')
    setBrandId(value.brand_id ?? '')
    setNewBrandName('')
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

  async function createClinicBrand() {
    const name = newBrandName.trim()
    if (!name || !clinicId) return
    const existing = brands.find((brand) => brand.name.toLocaleLowerCase() === name.toLocaleLowerCase())
    if (existing) {
      setBrandId(existing.id)
      setNewBrandName('')
      return
    }
    setBrandBusy(true)
    setError('')
    const { data, error: insertError } = await supabase.from('brands')
      .insert({ name, clinic_id: clinicId }).select('id,name,clinic_id').single()
    setBrandBusy(false)
    if (insertError) { setError(insertError.message); return }
    setBrands((current) => [...current, data as Brand].sort((left, right) => left.name.localeCompare(right.name)))
    setBrandId(data.id)
    setNewBrandName('')
  }

  async function searchProductAssist() {
    setLookupBusy(true)
    setLookupError('')
    setCandidates([])
    const searchTerm = barcode.trim() || query.trim()
    const inferredBarcode = barcode.trim() || (/^\d{8,14}$/.test(query.trim()) ? query.trim() : '')
    const lookupKey = normalizeLookupKey(inferredBarcode || searchTerm) || 'photo'
    setActiveLookupKey(lookupKey)
    const foundCandidates: ProductCandidate[] = []
    const failures: string[] = []

    async function requestAi(term: string, productBarcode: string) {
      const form = new FormData()
      form.set('query', productBarcode ? '' : term)
      form.set('barcode', productBarcode)
      const response = await fetch('/api/product-assist', { method: 'POST', body: form })
      const result = await response.json() as {
        error?: string
        source?: 'catalog' | 'ai' | 'exa'
        product?: CatalogProduct
        suggestion?: ProductSuggestion
        suggestions?: ProductSuggestion[]
        sources?: { title: string; url: string }[]
      }
      if (!response.ok) throw new Error(result.error || t('productLookupFailed'))
      if (result.source === 'catalog' && result.product) {
        let imageUrl: string | null = null
        if (result.product.approved_image_path) {
          imageUrl = `/api/inventory-image?path=${encodeURIComponent(result.product.approved_image_path)}&user=${encodeURIComponent(userId)}`
        }
        foundCandidates.push({ source: 'catalog', product: result.product, imageUrl })
        return result.product
      }
      const suggestions = result.suggestions?.length ? result.suggestions : result.suggestion ? [result.suggestion] : []
      if (suggestions.length) {
        const source = result.source === 'exa' ? 'exa' : 'ai'
        for (const suggestion of suggestions.slice(0, 3)) {
          foundCandidates.push({
            source,
            sourceName: source === 'exa' ? t('webSources') : t('aiSource'),
            suggestion,
            sources: result.sources ?? [],
            imageUrl: photoPreview || null,
            score: 0,
          })
        }
      }
      return suggestions[0] ?? null
    }

    try {
      setLookupStep('catalog')
      if (searchTerm) {
        const { data, error: catalogError } = await supabase.rpc('search_catalog', { search_term: searchTerm, result_limit: 8 })
        if (catalogError) throw new Error(catalogError.message)
        const products = (data ?? []) as CatalogProduct[]
        const orderedProducts = [...products].sort((left, right) =>
          Number(Boolean(right.barcode && right.barcode === inferredBarcode))
          - Number(Boolean(left.barcode && left.barcode === inferredBarcode)),
        ).slice(0, 3)
        for (const match of orderedProducts) {
          let imageUrl: string | null = catalogImageUrls[match.id] || null
          if (match.approved_image_path && !imageUrl) {
            imageUrl = `/api/inventory-image?path=${encodeURIComponent(match.approved_image_path)}&user=${encodeURIComponent(userId)}`
          }
          foundCandidates.push({ source: 'catalog', product: match, imageUrl })
        }
      }

      let externalSearchTerm = searchTerm
      let externalBarcode = inferredBarcode
      if (externalSearchTerm) {
        setLookupStep('pharmacy')
        try {
          const params = externalBarcode
            ? `barcode=${encodeURIComponent(externalBarcode)}`
            : `q=${encodeURIComponent(externalSearchTerm)}`
          const response = await fetch(`/api/pharmacy-search?${params}`)
          const result = await response.json() as { error?: string; suggestions?: PharmacyResult[] }
          if (response.ok) {
            for (const pharmacyProduct of result.suggestions ?? []) {
              if (!pharmacyProduct.name) continue
              foundCandidates.push({
                source: 'pharmacy',
                sourceName: pharmacyProduct.pharmacy,
                suggestion: {
                  name: pharmacyProduct.name,
                  description: pharmacyProduct.description ?? '',
                  barcode: externalBarcode || null,
                  brand: pharmacyProduct.brand ?? null,
                  product_type: '',
                  model: '',
                  color: '',
                  category_slugs: [],
                  presentation: 'individual',
                },
                sources: [{ title: pharmacyProduct.pharmacy, url: pharmacyProduct.productUrl }],
                imageUrl: pharmacyProduct.imageUrl,
                score: pharmacyProduct.score,
              })
            }
          } else {
            failures.push(result.error || response.statusText)
          }
        } catch (error) {
          failures.push(error instanceof Error ? error.message : t('pharmacyLookupFailed'))
        }

        setLookupStep('store')
        try {
          const response = await fetch(`/api/store-search?${externalBarcode ? `barcode=${encodeURIComponent(externalBarcode)}` : `q=${encodeURIComponent(externalSearchTerm)}`}`)
          const result = await response.json() as { error?: string; suggestions?: StoreResult[] }
          if (response.ok) {
            for (const storeResult of result.suggestions ?? []) {
              foundCandidates.push({
                source: 'store',
                sourceName: storeResult.store,
                suggestion: {
                  name: storeResult.name,
                  description: storeResult.description,
                  barcode: externalBarcode || null,
                  brand: null,
                  product_type: '',
                  model: '',
                  color: '',
                  category_slugs: [],
                  presentation: 'individual',
                },
                sources: [{ title: storeResult.store, url: storeResult.url }],
                imageUrl: storeResult.imageUrl,
                score: storeResult.score,
              })
            }
          } else {
            failures.push(result.error || response.statusText)
          }
        } catch (error) {
          failures.push(error instanceof Error ? error.message : t('storeLookupFailed'))
        }
      }

      if (externalSearchTerm) {
        setLookupStep('ai')
        try {
          await requestAi(externalSearchTerm, externalBarcode)
        } catch (error) {
          failures.push(error instanceof Error ? error.message : t('productLookupFailed'))
        }
      }

      const { data: rejectedRows, error: rejectedError } = await supabase.from('product_search_rejections')
        .select('candidate_key').eq('clinic_id', clinicId).eq('lookup_key', lookupKey)
      if (rejectedError) throw new Error(rejectedError.message)
      const rejectedKeys = new Set((rejectedRows ?? []).map((row) => row.candidate_key))
      const candidatesByGroup = (['catalog', 'pharmacy', 'store', 'ai', 'exa'] as const).flatMap((source) =>
        foundCandidates.filter((item) => item.source === source && !rejectedKeys.has(candidateKey(item)))
          .sort((left, right) => (right.source === 'catalog' ? 100 : right.score) - (left.source === 'catalog' ? 100 : left.score))
          .slice(0, 3),
      )
      const bestPharmacyMatch = candidatesByGroup.find((candidate) => candidate.source === 'pharmacy')
      if (bestPharmacyMatch && 'suggestion' in bestPharmacyMatch) {
        setProduct(null)
        setAiPrefill(bestPharmacyMatch.suggestion)
        setPrefillVersion((version) => version + 1)
        setQuery(bestPharmacyMatch.suggestion.name)
        setBarcode(bestPharmacyMatch.suggestion.barcode ?? inferredBarcode)
        const matchingBrand = brands.find((brand) => brand.name.toLocaleLowerCase() === bestPharmacyMatch.suggestion.brand?.toLocaleLowerCase())
        setBrandId(matchingBrand?.id ?? '')
        setNewBrandName(bestPharmacyMatch.suggestion.brand && !matchingBrand ? bestPharmacyMatch.suggestion.brand : '')
        setCategoryIds(bestPharmacyMatch.suggestion.category_slugs.flatMap((slug) => {
          const category = categories.find((value) => value.slug === slug)
          return category ? [category.id] : []
        }))
      }
      setCandidates(candidatesByGroup)
      if (!candidatesByGroup.length) {
        setLookupError(failures[0] || (foundCandidates.length ? t('allSuggestionsRejected') : t('productLookupFailed')))
      } else if (failures.length) {
        setLookupError(t('someSearchSourcesFailed'))
      }
    } catch (error) {
      setLookupError(error instanceof Error ? error.message : t('productLookupFailed'))
    } finally {
      setLookupBusy(false)
      setLookupStep(null)
    }
  }

  async function applyCandidate(selected: ProductCandidate) {
    if (selected.source === 'catalog') {
      chooseProduct(selected.product)
      setCandidates([])
      return
    }
    setProduct(null)
    setAiPrefill(selected.suggestion)
    setPrefillVersion((version) => version + 1)
    setQuery(selected.suggestion.name)
    setBarcode(selected.suggestion.barcode ?? barcode)
    const matchingBrand = brands.find((brand) => brand.name.toLocaleLowerCase() === selected.suggestion.brand?.toLocaleLowerCase())
    setBrandId(matchingBrand?.id ?? '')
    setNewBrandName(selected.suggestion.brand && !matchingBrand ? selected.suggestion.brand : '')
    setCategoryIds(selected.suggestion.category_slugs.flatMap((slug) => {
      const category = categories.find((value) => value.slug === slug)
      return category ? [category.id] : []
    }))
    if (selected.imageUrl && (selected.source === 'pharmacy' || selected.source === 'store')) {
      try {
        setPhoto(null)
        const response = await fetch(`/api/product-image?url=${encodeURIComponent(selected.imageUrl)}`)
        if (!response.ok) {
          const result = await response.json() as { error?: string }
          throw new Error(result.error || t('productImageImportFailed'))
        }
        const imageBlob = await response.blob()
        const extension = imageBlob.type === 'image/png' ? 'png' : imageBlob.type === 'image/webp' ? 'webp' : 'jpg'
        setPhoto(new File([imageBlob], `product-suggestion.${extension}`, { type: imageBlob.type }))
      } catch (error) {
        setError(error instanceof Error ? error.message : t('productImageImportFailed'))
      }
    }
    setCandidates([])
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

  async function rejectCandidate(candidate: ProductCandidate, lookupKey: string) {
    const { error: rejectionError } = await supabase.from('product_search_rejections').upsert({
      clinic_id: clinicId,
      lookup_key: lookupKey,
      candidate_key: candidateKey(candidate),
      created_by: userId,
    }, { onConflict: 'clinic_id,lookup_key,candidate_key', ignoreDuplicates: true })
    if (rejectionError) { setError(rejectionError.message); return }
    setCandidates((current) => current.filter((value) => candidateKey(value) !== candidateKey(candidate)))
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
      product_type: String(form.get('product_type') || '').trim(),
      model: String(form.get('model') || '').trim(),
      color: String(form.get('color') || '').trim(),
      quantity,
      min_quantity: Number(form.get('min_quantity') || 1),
      expiry_date: String(form.get('expiry_date') || '') || null,
      status: quantity === 0 ? 'missing' : String(form.get('status') || 'new'),
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
          <label>{t('findCatalogProduct')}<span className="input-with-icon catalog-search-input"><SearchIcon /><input value={query} onChange={(event) => { setQuery(event.target.value); setBarcode(''); setProduct(null); setAiPrefill(null); setCategoryIds([]); setCandidates([]) }} placeholder={t('searchNameOrBarcode')} autoComplete="off" /><button type="button" className="scan-button" aria-label={t('scanBarcode')} title={t('scanBarcode')} onClick={() => setScannerOpen(true)}><ScanIcon size={20} /></button></span></label>
          <p className="field-hint">{t('catalogLookupHint')}</p>
          {results.length > 0 && <ul className="catalog-results">{results.map((result) => <li key={result.id}><button type="button" onClick={() => chooseProduct(result)}>{catalogImageUrls[result.id] ? <img src={catalogImageUrls[result.id]} alt="" loading="lazy" decoding="async" onError={() => setCatalogImageUrls((current) => ({ ...current, [result.id]: '' }))} /> : <span className="catalog-result-image" aria-hidden="true">✳</span>}<span className="catalog-result-copy"><strong>{result.name}</strong><span>{result.barcode || t('noBarcode')}</span></span></button></li>)}</ul>}
          {(query.trim().length >= 2 || barcode.trim()) && <button type="button" className="secondary-button ai-search-button" disabled={lookupBusy} onClick={() => void searchProductAssist()}>{lookupBusy ? t(lookupStep === 'catalog' ? 'searchingCatalog' : lookupStep === 'pharmacy' ? 'searchingPharmacies' : lookupStep === 'store' ? 'searchingStores' : 'searchingWithAi') : t('searchCatalogPharmacyAi')}</button>}
          {lookupError && <p role="alert" className="error-message">{lookupError}</p>}
        </div>
        {product && <div className="catalog-selected" role="status">{catalogImageUrls[product.id] && <img src={catalogImageUrls[product.id]} alt={product.name} loading="lazy" decoding="async" onError={() => setCatalogImageUrls((current) => ({ ...current, [product.id]: '' }))} />}<span>{t('catalogProductSelected', { name: product.name })}</span><button type="button" className="text-button" onClick={() => { setProduct(null); setQuery(''); setBarcode(''); setCategoryIds([]); setBrandId(''); setNewBrandName('') }}>{t('clear')}</button></div>}
        <div className="form-grid">
          <label>{t('name')}<input name="name" required maxLength={160} defaultValue={product?.name ?? aiPrefill?.name ?? ''} key={`name-${prefillVersion}-${product?.id ?? aiPrefill?.name ?? 'custom'}`} /></label>
          <label>{t('barcode')}<input name="barcode" maxLength={128} value={barcode} onChange={(event) => { setBarcode(event.target.value); setQuery(''); setProduct(null); setAiPrefill(null); setCandidates([]) }} placeholder={t('barcodePlaceholder')} /></label>
          <CategoryPicker categories={categories} value={categoryIds} onChange={setCategoryIds} label={t('categories')} />
          <label>{t('brand')}<select name="brand_id" value={brandId} onChange={(event) => { setBrandId(event.target.value); setNewBrandName('') }}><option value="">{t('chooseBrand')}</option>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}{brand.clinic_id ? ` · ${t('clinicOnly')}` : ''}</option>)}</select></label>
          <div className="brand-create-control"><label>{t('brandName')}<input value={newBrandName} onChange={(event) => setNewBrandName(event.target.value)} maxLength={120} placeholder={aiPrefill?.brand || t('brandName')} /></label><button type="button" className="secondary-button" disabled={brandBusy || !newBrandName.trim()} onClick={() => void createClinicBrand()}>{brandBusy ? t('saving') : t('createBrand')}</button><span className="field-hint">{t('clinicBrandCreatedHint')}</span></div>
          <label className="field-wide">{t('description')}<textarea name="description" rows={4} maxLength={2000} defaultValue={product?.description ?? aiPrefill?.description ?? ''} key={`description-${prefillVersion}-${product?.id ?? aiPrefill?.name ?? 'custom'}`} /></label>
          <label>{t('productType')}<input name="product_type" maxLength={120} defaultValue={aiPrefill?.product_type ?? product?.product_type ?? ''} key={`product-type-${prefillVersion}-${product?.id ?? aiPrefill?.name ?? 'custom'}`} /></label>
          <label>{t('model')}<input name="model" maxLength={120} defaultValue={aiPrefill?.model ?? product?.model ?? ''} key={`model-${prefillVersion}-${product?.id ?? aiPrefill?.name ?? 'custom'}`} /></label>
          <label>{t('color')}<input name="color" maxLength={80} defaultValue={aiPrefill?.color ?? product?.color ?? ''} key={`color-${prefillVersion}-${product?.id ?? aiPrefill?.name ?? 'custom'}`} /></label>
          <label>{t('presentation')}<select name="presentation" defaultValue={product?.presentation ?? aiPrefill?.presentation ?? 'individual'} key={`presentation-${prefillVersion}-${product?.id ?? aiPrefill?.name ?? 'custom'}`}><option value="individual">{t('individual')}</option><option value="set">{t('set')}</option><option value="box">{t('box')}</option></select></label>
          <label>{t('status')}<select name="status" defaultValue="new"><option value="new">{t('new')}</option><option value="opened">{t('opened')}</option><option value="used">{t('used')}</option><option value="defective">{t('defective')}</option></select></label>
          <label>{t('quantity')}<input name="quantity" type="number" min="0" step="1" defaultValue="1" required /></label>
          <label>{t('minimumQuantity')}<input name="min_quantity" type="number" min="0" step="1" defaultValue="1" required /></label>
          <label>{t('expiryDate')}<input name="expiry_date" type="date" /></label>
          <div className="photo-picker field-wide">
            <label>{t('takePhoto')}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={selectPhoto} /></label>
            <label>{t('choosePhoto')}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={selectPhoto} /></label>
            <span className="field-hint">{t('approvedImageHint')}</span>
          </div>
        </div>
        {error && <p role="alert" className="error-message">{error}</p>}
        {message && <p role="status" className="success-message">{message}</p>}
        <div className="form-footer"><p className="field-hint">{t('expiryOptionalHint')}</p><button className="primary-button" type="submit" disabled={busy || !clinicId}>{busy ? t('saving') : t('saveItem')}</button></div>
      </form>
      {scannerOpen && <BarcodeScanner onDetected={handleBarcodeDetected} onClose={() => setScannerOpen(false)} />}
      {candidates.length > 0 && <div className="dialog-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setCandidates([]) }}>
        <section role="dialog" aria-modal="true" aria-labelledby="product-candidate-title" className="item-dialog card product-candidate-dialog">
          <h2 id="product-candidate-title">{t('productSuggestions')}</h2>
          <p className="subtle">{t('productSuggestionsHint')}</p>
          <div className="suggestion-list">
            {candidates.map((option, index) => {
              const name = option.source === 'catalog' ? option.product.name : option.suggestion.name
              const description = option.source === 'catalog' ? option.product.description : option.suggestion.description
              const sourceName = option.source === 'catalog' ? t('catalog') : option.sourceName
              const score = option.source === 'catalog' ? null : option.score
              const photoUrl = option.source === 'catalog'
                ? option.imageUrl
                : option.source === 'pharmacy' || option.source === 'store'
                  ? option.imageUrl ? `/api/product-image?url=${encodeURIComponent(option.imageUrl)}` : photoPreview
                  : photoPreview
              return <article className="suggestion-card" key={`${option.source}-${sourceName}-${name}-${index}`}>
                <div className="suggestion-image">
                  {photoUrl && <img src={photoUrl} alt={name} onError={(event) => { event.currentTarget.hidden = true }} />}
                  {!photoUrl && <span aria-hidden="true">✳</span>}
                </div>
                <div className="suggestion-copy">
                  <div className="suggestion-meta"><span>{sourceName}</span>{score !== null && <strong>{score}%</strong>}</div>
                  <h3>{name}</h3>
                  {description && <p>{description}</p>}
                  {option.source !== 'catalog' && option.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{t('viewProductSource', { source: source.title })}</a>)}
                  <div className="suggestion-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => void applyCandidate(option)}>{t('useSuggestion')}</button><button type="button" className="text-button danger-text" disabled={busy} onClick={() => void rejectCandidate(option, activeLookupKey)}>{t('notThisProduct')}</button></div>
                </div>
              </article>
            })}
          </div>
          <div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setCandidates([])}>{t('cancel')}</button></div>
        </section>
      </div>}
    </section>
  )
}
