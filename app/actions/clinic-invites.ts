'use server'

import { createHash, randomBytes } from 'node:crypto'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

type InviteResult = { ok: boolean; message?: string }

export async function inviteClinicMember(emailAddress: string): Promise<InviteResult> {
  const email = emailAddress.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return { ok: false, message: 'Enter a valid email address.' }
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { ok: false, message: authError?.message || 'Your session has expired. Sign in again.' }

  const { data: profile, error: profileError } = await supabase.from('profiles').select('primary_clinic_id').eq('id', user.id).single()
  if (profileError || !profile?.primary_clinic_id) {
    return { ok: false, message: profileError?.message || 'Your clinic workspace is not configured.' }
  }
  const { data: membership, error: membershipError } = await supabase.from('clinic_members')
    .select('role').eq('clinic_id', profile.primary_clinic_id).eq('user_id', user.id).single()
  if (membershipError) return { ok: false, message: membershipError.message }
  if (membership.role !== 'owner') return { ok: false, message: 'Only a clinic owner can invite team members.' }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    return { ok: false, message: 'Clinic invitations are not configured. Set the server-only SUPABASE_SERVICE_ROLE_KEY.' }
  }

  const adminClient = createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const now = new Date().toISOString()
  const { count: pendingCount, error: pendingError } = await adminClient.from('clinic_invites')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', profile.primary_clinic_id)
    .eq('email', email)
    .is('accepted_at', null)
    .gt('expires_at', now)
  if (pendingError) return { ok: false, message: pendingError.message }
  if (pendingCount) return { ok: false, message: 'A valid invitation has already been sent to this email address.' }

  const { count: clinicPendingCount, error: clinicPendingError } = await adminClient.from('clinic_invites')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', profile.primary_clinic_id)
    .is('accepted_at', null)
    .gt('expires_at', now)
  if (clinicPendingError) return { ok: false, message: clinicPendingError.message }
  if ((clinicPendingCount ?? 0) >= 20) return { ok: false, message: 'This clinic has reached its limit of 20 pending invitations.' }

  const invitationCode = randomBytes(32).toString('hex')
  const { data: invitation, error: invitationError } = await adminClient.from('clinic_invites').insert({
    clinic_id: profile.primary_clinic_id,
    email,
    code_hash: createHash('sha256').update(invitationCode).digest('hex'),
    invited_by: user.id,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  }).select('id').single()
  if (invitationError) return { ok: false, message: invitationError.message }

  const { error: sendError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { clinic_invite_code: invitationCode },
  })
  if (sendError) {
    const { error: cleanupError } = await adminClient.from('clinic_invites').delete().eq('id', invitation.id)
    if (cleanupError) return { ok: false, message: `${sendError.message} Invitation cleanup also failed: ${cleanupError.message}` }
    return { ok: false, message: sendError.message }
  }
  return { ok: true }
}
