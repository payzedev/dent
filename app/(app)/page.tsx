import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { AlertIcon, LayersIcon } from '@/components/icons'
import { InventoryMolar } from '@/components/inventory-molar'
import { LocalGreeting } from '@/components/local-greeting'

type HomeStat = {
  slug: string
  name_en: string
  name_es: string
  color_hex: string
  units: number
  distinct_items: number
  missing_count: number
  expiring_count: number
  total_units: number
  total_missing: number
  total_expiring: number
}

export default async function Home() {
  const t = await getTranslations()
  const locale = await getLocale()
  const supabase = await createClient()
  const [{ data: stats, error: statsError }, { data: { user } }] = await Promise.all([
    supabase.rpc('get_home_stats'),
    supabase.auth.getUser(),
  ])

  let fullName = ''
  let profileError = false
  if (user) {
    const { data: profile, error } = await supabase.from('profiles').select('full_name').eq('id', user.id).single()
    fullName = profile?.full_name ?? ''
    profileError = Boolean(error)
  }
  const errorMessage = statsError || profileError
  if (errorMessage) {
    return <section className="home-content"><div className="page-heading"><div><p className="eyebrow">{t('home')}</p><h1>{t('homeTitle')}</h1></div></div><p role="alert" className="error-message">{t('statsLoadFailed')}</p></section>
  }

  const rows = (stats ?? []) as HomeStat[]
  const totals = rows[0] ?? { total_units: 0, total_expiring: 0, total_missing: 0 }
  const firstName = fullName.trim().split(/\s+/)[0] || t('friend')

  return <section className="home-content">
    <div className="welcome-row"><div><p className="eyebrow">{new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(new Date())}</p><h1><LocalGreeting name={firstName} /></h1><p className="subtle">{t('clinicAtGlance')}</p></div><Link href="/add" className="primary-button">{t('addItem')}</Link></div>
    <section className="stats-grid">
      <div className="card hero-stat"><div><p className="eyebrow">{t('totalInventory')}</p><div className="big-number">{totals.total_units ?? 0}</div><p className="subtle">{t('units')}</p></div><span className="stat-icon blue"><LayersIcon /></span></div>
      <div className="card small-stat"><span className="stat-icon amber"><AlertIcon /></span><div><p className="eyebrow">{t('expiringSoon')}</p><strong>{totals.total_expiring ?? 0} <span>{t('items')}</span></strong></div></div>
      <div className="card small-stat"><span className="stat-icon rose"><AlertIcon /></span><div><p className="eyebrow">{t('missingStock')}</p><strong>{totals.total_missing ?? 0} <span>{t('items')}</span></strong></div></div>
    </section>
    <section className="card distribution-card"><h2>{t('inventoryDistribution')}</h2><p className="subtle">{t('unitsAcross')}</p><InventoryMolar categories={rows} /></section>
  </section>
}
