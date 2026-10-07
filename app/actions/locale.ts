'use server'
import {cookies} from 'next/headers'
import {revalidatePath} from 'next/cache'
import {createClient} from '@/lib/supabase/server'
export async function setLocale(locale:'en'|'es'){const store=await cookies();store.set('locale',locale,{httpOnly:false,sameSite:'lax',path:'/',maxAge:31536000});const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();if(user) await supabase.from('profiles').update({locale}).eq('id',user.id);revalidatePath('/', 'layout')}
