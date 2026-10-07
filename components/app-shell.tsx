'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { HomeIcon, LayersIcon, ScanIcon, UserIcon, MessageIcon, ShieldCheckIcon } from '@/components/icons'
import { SupportReplyBadge } from '@/components/support-reply-badge'
import { setLocale } from '@/app/actions/locale'

export function AppShell({
  children,
  isAdmin = false,
  initials = 'DS',
  unreadSupportReplies = 0,
}: {
  children: React.ReactNode
  isAdmin?: boolean
  initials?: string
  unreadSupportReplies?: number
}) {
  const path = usePathname()
  const router = useRouter()
  const t = useTranslations()
  const items = [
    ['/', 'home', HomeIcon],
    ['/inventory', 'inventory', LayersIcon],
    ['/add', 'add', ScanIcon],
    ['/profile', 'profile', UserIcon],
    ['/support', 'support', MessageIcon],
  ] as const

  async function changeLocale(locale: 'en' | 'es') {
    await setLocale(locale)
    router.refresh()
  }

  return <div className="app-shell">
    <header className="topbar">
      <Link href="/" className="brand"><span className="brand-mark" aria-hidden="true" /><span>{t('appName')}</span></Link>
      <nav className="header-actions" aria-label="Language selection">
        <button type="button" className="language-link" onClick={() => changeLocale('en')}>EN</button>
        <span aria-hidden="true">|</span>
        <button type="button" className="language-link" onClick={() => changeLocale('es')}>ES</button>
        <Link href="/profile" className="avatar" aria-label={t('profileLabel')}>{initials}</Link>
      </nav>
    </header>
    <main className="page-container">{children}</main>
    <nav className="bottom-nav" aria-label={t('navLabel')}>
      {items.map(([href, label, Icon]) => {
        const active = path === href
        return <Link key={label} href={href} className={active ? 'nav-item active' : 'nav-item'} aria-current={active ? 'page' : undefined}>
          <span className="nav-item-icon-wrap">
            <Icon className="nav-icon" />
            {label === 'support' && <SupportReplyBadge initialCount={unreadSupportReplies} />}
          </span>
          <span>{t(label)}</span>
        </Link>
      })}
      {isAdmin && <Link href="/admin" className={path === '/admin' ? 'nav-item active' : 'nav-item'}>
        <ShieldCheckIcon className="nav-icon" />
        <span>{t('admin')}</span>
      </Link>}
    </nav>
  </div>
}
