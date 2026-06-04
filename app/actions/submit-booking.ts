'use server'

import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}

export interface BookingData {
  name:              string
  phone:             string
  email:             string
  preferred_date:    string
  address:           string
  sq_ft:             number | null
  frequency:         string
  price_per_visit:   number
  first_visit_price: number
  overgrowth_fee:    number
  last_mow:          string
}

export async function submitBooking(data: BookingData): Promise<{ success: boolean; error?: string }> {
  if (!data.name.trim() || !data.phone.trim()) {
    return { success: false, error: 'Name and phone number are required.' }
  }

  const supabase = getSupabase()
  const { error } = await supabase.from('bookings').insert({
    name:              data.name.trim(),
    phone:             data.phone.trim(),
    email:             data.email.trim() || null,
    preferred_date:    data.preferred_date || null,
    address:           data.address,
    sq_ft:             data.sq_ft,
    frequency:         data.frequency,
    price_per_visit:   data.price_per_visit,
    first_visit_price: data.first_visit_price,
    overgrowth_fee:    data.overgrowth_fee || null,
    last_mow:          data.last_mow,
  })

  if (error) {
    return { success: false, error: 'Something went wrong. Please try again.' }
  }

  return { success: true }
}
