'use client'
import {useEffect,useState} from 'react'
import {useTranslations} from 'next-intl'
export function LocalGreeting({name}:{name:string}){const t=useTranslations();const [hour,setHour]=useState<number|null>(null);useEffect(()=>setHour(new Date().getHours()),[]);if(hour===null)return null;return <>{hour<12?t('goodMorning',{name}):hour<18?t('goodAfternoon',{name}):t('goodEvening',{name})}</>}
