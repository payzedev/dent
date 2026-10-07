'use client'

import { FormEvent, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'

export default function Forgot() {
  const t = useTranslations()
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const email = String(new FormData(event.currentTarget).get('email'))
    const { error: resetError } = await createClient().auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/reset-password` })
    if (resetError) { setError(resetError.message); return }
    setSent(true)
  }

  return <main className="auth-page"><div className="auth-card">
    <h1>{t('forgotPassword')}</h1><p className="subtle">{t('resetEmailDescription')}</p>
    <form onSubmit={submit} className="auth-form"><label>{t('email')}<input name="email" type="email" required autoComplete="email" /></label>
      {error && <p role="alert" className="error">{error}</p>}
      <button className="primary-button full">{t('sendResetLink')}</button>
    </form>
    {sent && <p role="status">{t('resetEmailSent')}</p>}
    <Link href="/login">{t('backToLogin')}</Link>
  </div></main>
}
