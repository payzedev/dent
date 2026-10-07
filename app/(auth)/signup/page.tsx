'use client'

import { FormEvent, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'

export default function Signup() {
  const t = useTranslations()
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password'))
    const confirmation = String(form.get('password_confirmation'))
    if (password !== confirmation) {
      setError(t('passwordsDoNotMatch'))
      return
    }
    const { error: signupError } = await createClient().auth.signUp({
      email: String(form.get('email')),
      password,
      options: { data: { full_name: String(form.get('name')).trim(), clinic_name: String(form.get('clinic_name')).trim() } },
    })
    if (signupError) { setError(signupError.message); return }
    setMessage(t('signupConfirmation'))
  }

  return <main className="auth-page"><div className="auth-card">
    <h1>{t('createAccount')}</h1><p className="subtle">{t('signupDescription')}</p>
    <form onSubmit={submit} className="auth-form">
      <label>{t('name')}<input name="name" required maxLength={120} autoComplete="name" /></label>
      <label>{t('clinicName')}<input name="clinic_name" required maxLength={160} autoComplete="organization" /></label>
      <label>{t('email')}<input name="email" type="email" required autoComplete="email" /></label>
      <label>{t('password')}<span className="password-control"><input name="password" type={showPassword ? 'text' : 'password'} minLength={8} required autoComplete="new-password" /><button type="button" className="password-toggle" aria-label={t(showPassword ? 'hidePassword' : 'showPassword')} onClick={() => setShowPassword((visible) => !visible)}>{t(showPassword ? 'hidePassword' : 'showPassword')}</button></span></label>
      <label>{t('confirmPassword')}<span className="password-control"><input name="password_confirmation" type={showConfirmPassword ? 'text' : 'password'} minLength={8} required autoComplete="new-password" /><button type="button" className="password-toggle" aria-label={t(showConfirmPassword ? 'hidePassword' : 'showPassword')} onClick={() => setShowConfirmPassword((visible) => !visible)}>{t(showConfirmPassword ? 'hidePassword' : 'showPassword')}</button></span></label>
      {error && <p role="alert" className="error">{error}</p>}
      <button className="primary-button full">{t('signup')}</button>
    </form>
    {message && <p role="status">{message}</p>}
    <p>{t('alreadyAccount')} <Link href="/login">{t('login')}</Link></p>
  </div></main>
}
