'use client'

import { useEffect } from 'react'
import { captureAttribution } from '@/lib/attribution'

export default function AttributionCapture() {
  useEffect(() => { captureAttribution() }, [])
  return null
}
