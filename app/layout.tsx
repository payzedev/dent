import {Analytics} from '@vercel/analytics/next'
import type {Metadata,Viewport} from 'next'
import {NextIntlClientProvider} from 'next-intl'
import {getLocale,getMessages} from 'next-intl/server'
import './globals.css'
export const metadata:Metadata={title:'DentaStock — Dental inventory management',description:'A calm, simple way to keep your dental clinic inventory organized.'}
export const viewport:Viewport={colorScheme:'light',themeColor:'#FAFBFF',viewportFit:'cover'}
export default async function RootLayout({children}:{children:React.ReactNode}){const locale=await getLocale();const messages=await getMessages();return <html lang={locale}><body suppressHydrationWarning><NextIntlClientProvider locale={locale} messages={messages}>{children}</NextIntlClientProvider>{process.env.NODE_ENV==='production'&&<Analytics/>}</body></html>}
