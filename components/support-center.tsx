'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'

type Report = { id: string; clinic_id: string; created_by: string; subject: string; message: string; image_path: string | null; status: 'open' | 'in_progress' | 'resolved'; created_at: string }
type Reply = { id: string; report_id: string; author_id: string; message: string; created_at: string }

export function SupportCenter() {
  const t = useTranslations()
  const locale = useLocale()
  const supabase = useMemo(() => createClient(), [])
  const [reports, setReports] = useState<Report[]>([])
  const [replies, setReplies] = useState<Reply[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [clinicId, setClinicId] = useState('')
  const [userId, setUserId] = useState('')
  const [admin, setAdmin] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [image, setImage] = useState<File | null>(null)
  const [attachmentUrl, setAttachmentUrl] = useState('')

  const load = useCallback(async (preferredReportId?: string) => {
    setError('')
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) { setError(authError?.message || t('sessionRequired')); return }
    setUserId(user.id)
    setAdmin(user.email?.toLowerCase() === 'remgoficial@gmail.com')
    const { data: profile, error: profileError } = await supabase.from('profiles').select('primary_clinic_id').eq('id', user.id).single()
    if (profileError) { setError(profileError.message); return }
    setClinicId(profile?.primary_clinic_id || '')
    const { data, error: reportsError } = await supabase.from('support_reports').select('id,clinic_id,created_by,subject,message,image_path,status,created_at').order('created_at', { ascending: false })
    if (reportsError) { setError(reportsError.message); return }
    const reportRows = (data ?? []) as Report[]
    setReports(reportRows)
    const current = preferredReportId && reportRows.some((report) => report.id === preferredReportId)
      ? preferredReportId
      : selected && reportRows.some((report) => report.id === selected) ? selected : reportRows[0]?.id ?? null
    setSelected(current)
    if (current) {
      const { data: replyRows, error: repliesError } = await supabase.from('support_replies').select('id,report_id,author_id,message,created_at').eq('report_id', current).order('created_at')
      if (repliesError) { setError(repliesError.message); return }
      setReplies((replyRows ?? []) as Reply[])
      const report = reportRows.find((row) => row.id === current)
      if (report?.image_path) {
        const { data: signedImage, error: imageError } = await supabase.storage.from('inventory-images').createSignedUrl(report.image_path, 3600)
        if (imageError) { setError(imageError.message); return }
        setAttachmentUrl(signedImage.signedUrl)
      } else setAttachmentUrl('')
    } else setReplies([])
  }, [selected, supabase, t])

  useEffect(() => { void load() }, [load])

  async function createReport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setError(''); setNotice('')
    const formElement = event.currentTarget
    if (!clinicId || !userId) { setBusy(false); setError(t('clinicNotConfigured')); return }
    const form = new FormData(formElement)
    let imagePath: string | null = null
    if (image) {
      const ext = image.type === 'image/png' ? 'png' : image.type === 'image/webp' ? 'webp' : 'jpg'
      imagePath = `${clinicId}/${userId}/${crypto.randomUUID()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('inventory-images').upload(imagePath, image, { contentType: image.type, upsert: false })
      if (uploadError) { setBusy(false); setError(uploadError.message); return }
    }
    const { data, error: createError } = await supabase.from('support_reports').insert({
      clinic_id: clinicId,
      created_by: userId,
      subject: String(form.get('subject')).trim(),
      message: String(form.get('message')).trim(),
      image_path: imagePath,
    }).select('id').single()
    if (createError) {
      if (imagePath) await supabase.storage.from('inventory-images').remove([imagePath])
      setBusy(false); setError(createError.message); return
    }
    formElement.reset()
    setImage(null); setSelected(data.id); setNotice(t('reportSubmitted')); setBusy(false)
    await load(data.id)
  }

  async function sendReply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || !userId) return
    setBusy(true); setError('')
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const { error: replyError } = await supabase.from('support_replies').insert({ report_id: selected, author_id: userId, message: String(form.get('reply')).trim() })
    setBusy(false)
    if (replyError) { setError(replyError.message); return }
    formElement.reset()
    await load()
  }

  async function updateStatus(status: Report['status']) {
    if (!selected) return
    const { error: statusError } = await supabase.from('support_reports').update({ status }).eq('id', selected)
    if (statusError) { setError(statusError.message); return }
    await load()
  }

  const active = reports.find((report) => report.id === selected)
  return <section className="support-content">
    <div className="page-heading"><div><p className="eyebrow">{t('support')}</p><h1>{t('supportTitle')}</h1><p className="subtle">{t('supportDescription')}</p></div></div>
    <div className="support-grid">
      <form className="card settings-form support-new" onSubmit={(event) => void createReport(event)}>
        <h2>{t('newReport')}</h2><label>{t('subject')}<input name="subject" required maxLength={160} /></label>
        <label>{t('describeIssue')}<textarea name="message" rows={5} required maxLength={5000} /></label>
        <label>{t('attachImage')}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
          const file = event.target.files?.[0] ?? null
          if (file && (file.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) {
            setError(t('invalidImage')); event.target.value = ''; setImage(null); return
          }
          setError(''); setImage(file)
        }} /><span className="field-hint">{t('supportImageHint')}</span></label>
        <button className="primary-button" disabled={busy}>{busy ? t('sending') : t('sendReport')}</button>
      </form>
      <section className="card support-thread">
        <h2>{t('yourReports')}</h2>
        {reports.length === 0 ? <p className="subtle">{t('noReports')}</p> : <div className="report-tabs" role="tablist" aria-label={t('yourReports')}>{reports.map((report) => <button type="button" role="tab" aria-selected={selected === report.id} className={selected === report.id ? 'report-tab selected' : 'report-tab'} key={report.id} onClick={() => setSelected(report.id)}><strong>{report.subject}</strong><span className={`status-badge status-${report.status}`}>{t(report.status)}</span></button>)}</div>}
        {active && <article className="report-detail"><div className="report-heading"><div><h3>{active.subject}</h3><p className="field-hint">{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(active.created_at))}</p></div>{admin && <select aria-label={t('reportStatus')} value={active.status} onChange={(event) => void updateStatus(event.target.value as Report['status'])}><option value="open">{t('open')}</option><option value="in_progress">{t('inProgress')}</option><option value="resolved">{t('resolved')}</option></select>}</div>
          <p className="report-message">{active.message}</p>
          {attachmentUrl && <a className="report-attachment" href={attachmentUrl} target="_blank" rel="noreferrer">{t('viewAttachment')}</a>}
          <div className="reply-list">{replies.filter((reply) => reply.report_id === active.id).map((reply) => <div className={reply.author_id === userId ? 'reply own-reply' : 'reply'} key={reply.id}><p>{reply.message}</p><span>{reply.author_id === userId ? t('you') : t('supportTeam')} · {new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(reply.created_at))}</span></div>)}</div>
          <form className="reply-form" onSubmit={(event) => void sendReply(event)}><label>{t('reply')}<textarea name="reply" rows={3} required maxLength={5000} /></label><button className="secondary-button" disabled={busy}>{t('sendReply')}</button></form>
        </article>}
      </section>
    </div>
    {error && <p role="alert" className="error-message">{error}</p>}
    {notice && <p role="status" className="success-message">{notice}</p>}
  </section>
}
