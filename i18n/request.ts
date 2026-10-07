import {getRequestConfig} from 'next-intl/server'
import {cookies, headers} from 'next/headers'

export default getRequestConfig(async () => {
  const cookieStore = await cookies()
  const saved = cookieStore.get('locale')?.value
  const locale = saved === 'es' || saved === 'en' ? saved : ((await headers()).get('accept-language')?.toLowerCase().startsWith('es') ? 'es' : 'en')
  return {locale, messages: (await import(`../messages/${locale}.json`)).default}
})
