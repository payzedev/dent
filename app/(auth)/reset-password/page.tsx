'use client'

import { FormEvent, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'

export default function Reset() {
  const t = useTranslations()
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setDone(false); setError('')
    const password = String(new FormData(event.currentTarget).get('password'))
    const { error: updateError } = await createClient().auth.updateUser({ password })
    if (updateError) { setError(updateError.message); return }
    setDone(true)
  }

  return <main className="auth-page"><div className="auth-card">
    <h1>{t('chooseNewPassword')}</h1><p className="subtle">{t('resetPasswordDescription')}</p>
    <form onSubmit={submit} className="auth-form"><label>{t('newPassword')}<input name="password" type="password" minLength={8} required autoComplete="new-password" /></label>
      {error && <p role="alert" className="error">{error}</p>}
      {done && <p role="status">{t('passwordUpdated')}</p>}
      <button className="primary-button full">{t('resetPassword')}</button>
    </form>
    <Link href="/login">{t('backToLogin')}</Link>
  </div></main>
}
