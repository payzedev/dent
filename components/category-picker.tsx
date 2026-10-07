'use client'

import { useEffect, useRef, useState } from 'react'
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
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const selected = categories.filter((category) => value.includes(category.id))

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
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

  return <>
    <div className="category-picker">
      <span className="field-label">{label}</span>
      <button
        ref={triggerRef}
        className="category-picker-trigger"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span className="category-picker-value">
          {selected.length
            ? selected.map((category) => <span className="category-selection-chip" key={category.id}>{locale === 'es' ? category.name_es : category.name_en}</span>)
            : <span className="category-picker-placeholder">{t('chooseCategory')}</span>}
        </span>
        <span className="category-picker-chevron" aria-hidden="true">⌄</span>
      </button>
      {selected.map((category) => <input key={category.id} type="hidden" name="category_ids" value={category.id} />)}
      <span className="field-hint">{t('selectMultipleCategories')}</span>
    </div>
    {open && <div className="category-sheet-backdrop" onClick={(event) => {
      if (event.target === event.currentTarget) {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }}>
      <section className="category-sheet card" role="dialog" aria-modal="true" aria-labelledby="category-sheet-title">
        <header className="category-sheet-header">
          <div>
            <h2 id="category-sheet-title">{label}</h2>
            <p className="subtle">{t('selectMultipleCategories')}</p>
          </div>
          <button ref={closeRef} type="button" className="icon-button" aria-label={t('close')} onClick={() => {
            setOpen(false)
            triggerRef.current?.focus()
          }}><XIcon /></button>
        </header>
        <div className="category-sheet-options">
          {categories.map((category) => {
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
        </div>
        <footer className="category-sheet-footer">
          <span className="field-hint">{t('selectedCategoriesCount', { count: selected.length })}</span>
          <button type="button" className="primary-button" onClick={() => {
            setOpen(false)
            triggerRef.current?.focus()
          }}>{t('done')}</button>
        </footer>
      </section>
    </div>}
  </>
}
