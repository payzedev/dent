import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/supabase/server'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await requireAdmin())) notFound()
  return children
}
