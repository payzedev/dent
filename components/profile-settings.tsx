'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { inviteClinicMember } from '@/app/actions/clinic-invites'

type Profile = { id: string; full_name: string; email: string | null; phone: string | null; clinic_name: string; primary_clinic_id: string | null }
type TeamMember = { id: string; name: string; email: string; role: string }

export function ProfileSettings() {
  const t = useTranslations()
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [team, setTeam] = useState<TeamMember[]>([])
  const [isOwner, setIsOwner] = useState(false)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [inviteBusy, setInviteBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (cancelled) return
      if (authError || !user) { setError(authError?.message || t('sessionRequired')); return }
      const { data, error: profileError } = await supabase.from('profiles').select('id,full_name,email,phone,clinic_name,primary_clinic_id').eq('id', user.id).single()
      if (cancelled) return
      if (profileError) { setError(profileError.message); return }
      setProfile(data as Profile)
      setEmail(user.email || '')
      if (data.primary_clinic_id) {
        const { data: members, error: membersError } = await supabase.from('clinic_members').select('user_id,role').eq('clinic_id', data.primary_clinic_id)
        if (cancelled) return
        if (membersError) { setError(membersError.message); return }
        const memberRows = (members ?? []) as Array<{ user_id: string; role: string }>
        setIsOwner(memberRows.some((member) => member.user_id === user.id && member.role === 'owner'))
        if (memberRows.length) {
          const { data: profiles, error: teamError } = await supabase.from('profiles').select('id,full_name,email').in('id', memberRows.map((member) => member.user_id))
          if (cancelled) return
          if (teamError) { setError(teamError.message); return }
          const details = (profiles ?? []) as Array<{ id: string; full_name: string; email: string | null }>
          setTeam(memberRows.map((member) => {
            const person = details.find((entry) => entry.id === member.user_id)
            return { id: member.user_id, name: person?.full_name || t('unnamedUser'), email: person?.email || '', role: member.role }
          }))
        }
      }
    }
    void load()
    return () => { cancelled = true }
  }, [supabase, t])

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profile) return
    setBusy(true); setError(''); setNotice('')
    const form = new FormData(event.currentTarget)
    const fullName = String(form.get('full_name')).trim()
    const clinicName = String(form.get('clinic_name')).trim()
    const phone = String(form.get('phone')).trim()
    const { error: profileError } = await supabase.from('profiles').update({ full_name: fullName, ...(isOwner ? { clinic_name: clinicName } : {}), phone }).eq('id', profile.id)
    if (profileError) { setBusy(false); setError(profileError.message); return }
    if (profile.primary_clinic_id && isOwner) {
      const { error: clinicError } = await supabase.from('clinics').update({ name: clinicName }).eq('id', profile.primary_clinic_id)
      if (clinicError) { setBusy(false); setError(clinicError.message); return }
    }
    setProfile({ ...profile, full_name: fullName, clinic_name: isOwner ? clinicName : profile.clinic_name, phone })
    setBusy(false); setNotice(t('profileSaved'))
    router.refresh()
  }

  async function updateEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setError(''); setNotice('')
    const form = new FormData(event.currentTarget)
    const nextEmail = String(form.get('new_email')).trim()
    const { error: updateError } = await supabase.auth.updateUser({ email: nextEmail })
    setBusy(false)
    if (updateError) { setError(updateError.message); return }
    setNotice(t('emailConfirmationSent'))
  }

  async function updatePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setError(''); setNotice('')
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const password = String(form.get('new_password'))
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (updateError) { setError(updateError.message); return }
    formElement.reset()
    setNotice(t('passwordUpdated'))
  }

  async function sendInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setInviteBusy(true); setError(''); setNotice('')
    const formElement = event.currentTarget
    const emailAddress = String(new FormData(formElement).get('invite_email'))
    const result = await inviteClinicMember(emailAddress)
    setInviteBusy(false)
    if (!result.ok) { setError(result.message || t('genericError')); return }
    formElement.reset()
    setNotice(t('inviteSent', { email: emailAddress }))
  }

  async function signOut() {
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) { setError(signOutError.message); return }
    router.replace('/login')
    router.refresh()
  }

  if (!profile) return <p className="subtle" role="status">{error || t('loading')}</p>
  return <section className="form-page">
    <div className="page-heading"><div><p className="eyebrow">{t('profile')}</p><h1>{t('profileTitle')}</h1><p className="subtle">{t('profileDescription')}</p></div></div>
    <div className="profile-grid">
      <form className="card settings-form" onSubmit={saveProfile}>
        <h2>{t('clinicInformation')}</h2>
        <label>{t('name')}<input name="full_name" defaultValue={profile.full_name} required maxLength={120} /></label>
        <label>{t('clinicName')}<input name="clinic_name" defaultValue={profile.clinic_name} required maxLength={160} disabled={!isOwner} /></label>
        <label>{t('phone')}<input name="phone" type="tel" defaultValue={profile.phone || ''} maxLength={32} /></label>
        <button className="primary-button" disabled={busy}>{t('saveChanges')}</button>
      </form>
      <form className="card settings-form" onSubmit={updateEmail}>
        <h2>{t('changeEmail')}</h2><p className="field-hint">{t('currentEmail')}: {email}</p>
        <label>{t('newEmail')}<input name="new_email" type="email" required autoComplete="email" /></label>
        <button className="secondary-button" disabled={busy}>{t('updateEmail')}</button>
      </form>
      <form className="card settings-form" onSubmit={updatePassword}>
        <h2>{t('changePassword')}</h2>
        <label>{t('newPassword')}<input name="new_password" type="password" minLength={8} required autoComplete="new-password" /></label>
        <button className="secondary-button" disabled={busy}>{t('updatePassword')}</button>
      </form>
      <section className="card settings-form">
        <h2>{t('clinicTeam')}</h2><p className="subtle">{t('clinicTeamDescription')}</p>
        <ul className="team-list">{team.map((member) => <li key={member.id}><span><strong>{member.name}</strong><small>{member.email}</small></span><span className="status-badge status-new">{t(member.role === 'owner' ? 'clinicOwner' : 'clinicStaff')}</span></li>)}</ul>
        {isOwner && <form className="invite-form" onSubmit={(event) => void sendInvite(event)}><label>{t('inviteClinicMember')}<input name="invite_email" type="email" required autoComplete="email" /></label><p className="field-hint">{t('inviteExpiryHint')}</p><button className="secondary-button" disabled={inviteBusy}>{inviteBusy ? t('sending') : t('sendInvite')}</button></form>}
        {!isOwner && <p className="field-hint">{t('ownerMustInvite')}</p>}
      </section>
    </div>
    {error && <p role="alert" className="error-message">{error}</p>}
    {notice && <p role="status" className="success-message">{notice}</p>}
    <button className="text-button sign-out-button" type="button" onClick={() => void signOut()}>{t('signOut')}</button>
  </section>
}
