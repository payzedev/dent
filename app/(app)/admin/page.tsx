import { notFound } from 'next/navigation'
import { AdminConsole } from '@/components/admin-console'
import { requireAdmin } from '@/lib/supabase/server'

export default async function Admin() {
  if (!(await requireAdmin())) notFound()
  return <AdminConsole />
}
