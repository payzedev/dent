import { redirect } from 'next/navigation'
import { AppShell } from '@/components/app-shell'
import { createClient } from '@/lib/supabase/server'

export default async function Layout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const [{ data: profile, error: profileError }, { data: unreadReplyCount, error: unreadError }] = await Promise.all([
    supabase.from('profiles').select('full_name, role').eq('id', user.id).single(),
    supabase.rpc('get_unread_support_reply_count'),
  ])
  if (profileError) console.error('Could not load user profile for application navigation', profileError.message)
  if (unreadError) console.error('Could not load unread support replies for application navigation', unreadError.message)
  const initials = (profile?.full_name || user.email || 'DS').split(/\s+/).filter(Boolean).slice(0, 2).map((part: string) => part[0]).join('').toUpperCase() || 'DS'
  return <AppShell
    isAdmin={user.email?.toLowerCase() === 'remgoficial@gmail.com' && profile?.role === 'admin'}
    initials={initials}
    unreadSupportReplies={Number(unreadReplyCount) || 0}
  >{children}</AppShell>
}
