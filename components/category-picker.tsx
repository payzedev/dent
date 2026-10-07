'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { XIcon } from '@/components/icons'

export type PickableCategory = {
  id: string
  name_en: string
  name_es: string
  color_hex?: string
}

type CategoryPickerProps = {
  categories: PickableCategory[]
  value: string[]
  onChange: (categoryIds: string[]) => void
  label: string
}

export function CategoryPicker({ categories, value, onChange, label }: CategoryPickerProps) {
  const t = useTranslations()
  const locale = useLocale()
  const pickerId = useId()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const selected = categories.filter((category) => value.includes(category.id))
  const normalizedSearch = normalizeCategorySearch(search)
  const visibleCategories = useMemo(() => categories.filter((category) => {
    const name = locale === 'es' ? category.name_es : category.name_en
    return normalizeCategorySearch(name).includes(normalizedSearch)
  }), [categories, locale, normalizedSearch])

  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
        return
      }
      if (event.key === 'Tab') {
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled)',
        ) ?? [])
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open])

  function toggle(categoryId: string) {
    onChange(value.includes(categoryId)
      ? value.filter((id) => id !== categoryId)
      : [...value, categoryId])
  }

  function closePicker() {
    setOpen(false)
    setSearch('')
    triggerRef.current?.focus()
  }

  return <>
    <div className="category-picker">
      <span className="field-label" id={`${pickerId}-label`}>{label}</span>
      <button
        ref={triggerRef}
        className="category-picker-trigger"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={`${pickerId}-label`}
        aria-describedby={`${pickerId}-selected`}
        onClick={() => {
          setSearch('')
          setOpen(true)
        }}
      >
        <span className="category-picker-value">
          {selected.length
            ? <>
              {selected.slice(0, 2).map((category) => <span className="category-selection-chip" key={category.id}>{locale === 'es' ? category.name_es : category.name_en}</span>)}
              {selected.length > 2 && <span className="category-selection-more">{t('moreCategoriesSelected', { count: selected.length - 2 })}</span>}
            </>
            : <span className="category-picker-placeholder">{t('chooseCategory')}</span>}
        </span>
        <span className="category-picker-chevron" aria-hidden="true">⌄</span>
      </button>
      <span id={`${pickerId}-selected`} className="sr-only">
        {selected.length
          ? selected.map((category) => locale === 'es' ? category.name_es : category.name_en).join(', ')
          : t('chooseCategory')}
      </span>
      {selected.map((category) => <input key={category.id} type="hidden" name="category_ids" value={category.id} />)}
      <span className="field-hint">{t('selectMultipleCategories')}</span>
    </div>
    {open && <div className="category-sheet-backdrop" onClick={(event) => {
      if (event.target === event.currentTarget) {
        closePicker()
      }
    }}>
      <section ref={dialogRef} className="category-sheet card" role="dialog" aria-modal="true" aria-labelledby={`${pickerId}-title`}>
        <header className="category-sheet-header">
          <div>
            <h2 id={`${pickerId}-title`}>{label}</h2>
            <p className="subtle">{t('selectMultipleCategories')}</p>
          </div>
          <button type="button" className="icon-button" aria-label={t('close')} onClick={closePicker}><XIcon /></button>
        </header>
        <label className="category-search">
          <span className="sr-only">{t('searchCategories')}</span>
          <input ref={searchRef} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('searchCategories')} autoComplete="off" />
        </label>
        <div className="category-sheet-options">
          {visibleCategories.map((category) => {
            const isSelected = value.includes(category.id)
            return <button
              key={category.id}
              type="button"
              className={isSelected ? 'category-sheet-option selected' : 'category-sheet-option'}
              aria-pressed={isSelected}
              onClick={() => toggle(category.id)}
            >
              <span className="category-option-color" style={{ backgroundColor: category.color_hex ?? '#D5D9E6' }} />
              <span>{locale === 'es' ? category.name_es : category.name_en}</span>
              <span className="category-option-check" aria-hidden="true">{isSelected ? '✓' : ''}</span>
            </button>
          })}
          {visibleCategories.length === 0 && <p className="category-sheet-empty">{t('noCategoriesFound')}</p>}
        </div>
        <footer className="category-sheet-footer">
          <span className="field-hint">{t('selectedCategoriesCount', { count: selected.length })}</span>
          <button type="button" className="primary-button" onClick={closePicker}>{t('done')}</button>
        </footer>
      </section>
    </div>}
  </>
}

function normalizeCategorySearch(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim()
}
