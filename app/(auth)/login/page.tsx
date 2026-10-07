'use client'
import { FormEvent, Suspense, useState } from 'react'; import Link from 'next/link'; import { useRouter, useSearchParams } from 'next/navigation'; import { createClient } from '@/lib/supabase/client'
import { useTranslations } from 'next-intl'
function getSafeNextPath(next: string | null, origin: string) {
  if (!next) return '/'
  try {
    const destination = new URL(next, origin)
    if (destination.origin !== origin) return '/'
    return `${destination.pathname}${destination.search}${destination.hash}`
  } catch {
    return '/'
  }
}
function LoginForm(){const t=useTranslations();const router=useRouter();const searchParams=useSearchParams();const [error,setError]=useState(''); async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);const {error}=await createClient().auth.signInWithPassword({email:String(f.get('email')),password:String(f.get('password'))});if(error)setError(t('loginFailed'));else {router.replace(getSafeNextPath(searchParams.get('next'), window.location.origin))}} return <main className="auth-page"><div className="auth-card"><h1>{t('welcomeBack')}</h1><p className="subtle">{t('loginDescription')}</p><form onSubmit={submit} className="auth-form"><label>{t('email')}<input name="email" type="email" required autoComplete="email" /></label><label>{t('password')}<input name="password" type="password" required autoComplete="current-password" /></label>{error&&<p role="alert" className="error">{error}</p>}<button className="primary-button full">{t('login')}</button></form><Link href="/forgot-password">{t('forgotPassword')}</Link><p>{t('newHere')} <Link href="/signup">{t('createAccount')}</Link></p></div></main>}
export default function Login(){const t=useTranslations();return <Suspense fallback={<main className="auth-page"><div className="auth-card"><h1>{t('welcomeBack')}</h1></div></main>}><LoginForm /></Suspense>}
