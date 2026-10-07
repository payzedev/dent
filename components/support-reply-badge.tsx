'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function SupportReplyBadge({ initialCount }: { initialCount: number }) {
  const [count, setCount] = useState(initialCount)

  useEffect(() => {
    const supabase = createClient()
    let active = true
    const refresh = async () => {
      const { data, error } = await supabase.rpc('get_unread_support_reply_count')
      if (!active) return
      if (error) {
        console.error('Could not load unread support reply count', error.message)
        return
      }
      setCount(Number(data) || 0)
    }
    const handleRead = () => void refresh()
    window.addEventListener('support-replies-read', handleRead)
    const timer = window.setInterval(() => void refresh(), 30_000)
    return () => {
      active = false
      window.removeEventListener('support-replies-read', handleRead)
      window.clearInterval(timer)
    }
  }, [])

  return count > 0 ? <span className="support-unread-badge" aria-label={`${count} unread support messages`}>{count > 99 ? '99+' : count}</span> : null
}
