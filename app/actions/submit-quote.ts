'use server'

import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}

export type QuoteState = { success: true } | { success: false; error: string } | null

export async function submitQuote(
  _prevState: QuoteState,
  formData: FormData
): Promise<QuoteState> {
  const name = (formData.get('name') as string)?.trim()
  const phone = (formData.get('phone') as string)?.trim()
  const postcode = (formData.get('postcode') as string)?.trim()
  const yard_size = (formData.get('yard_size') as string)?.trim()

  if (!name || !phone || !postcode || !yard_size) {
    return { success: false, error: 'Please fill in all fields.' }
  }

  const supabase = getSupabase()
  const { error } = await supabase
    .from('quotes')
    .insert({ name, phone, postcode, yard_size })

  if (error) {
    return { success: false, error: 'Something went wrong. Please try again.' }
  }

  return { success: true }
}
