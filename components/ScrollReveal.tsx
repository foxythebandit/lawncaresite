'use client'
import { useEffect } from 'react'

export default function ScrollReveal() {
  useEffect(() => {
    const fadeEls = document.querySelectorAll<HTMLElement>('.reveal')
    const fadeObserver = new IntersectionObserver(
      entries => {
        entries.forEach(e => {
          if (!e.isIntersecting) return
          const el = e.target as HTMLElement
          const delay = parseInt(el.dataset.delay ?? '0')
          setTimeout(() => {
            el.classList.add('revealed')
            setTimeout(() => { el.style.willChange = 'auto' }, 700)
          }, delay)
          fadeObserver.unobserve(el)
        })
      },
      { threshold: 0.12 }
    )
    fadeEls.forEach(el => fadeObserver.observe(el))

    const barEls = document.querySelectorAll<HTMLElement>('[data-reveal-width]')
    const barObserver = new IntersectionObserver(
      entries => {
        entries.forEach(e => {
          if (!e.isIntersecting) return
          const el = e.target as HTMLElement
          const delay = parseInt(el.dataset.delay ?? '0')
          setTimeout(() => { el.style.width = el.dataset.revealWidth! }, delay)
          barObserver.unobserve(el)
        })
      },
      { threshold: 0.4 }
    )
    barEls.forEach(bar => barObserver.observe(bar))

    return () => { fadeObserver.disconnect(); barObserver.disconnect() }
  }, [])

  return null
}
