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

    // Observe the bar containers (which have real dimensions), not the 0-width fills
    const barContainers = document.querySelectorAll<HTMLElement>('.noise-bar-bg')
    const barObserver = new IntersectionObserver(
      entries => {
        entries.forEach(e => {
          if (!e.isIntersecting) return
          const container = e.target as HTMLElement
          const fill = container.querySelector<HTMLElement>('[data-reveal-width]')
          if (!fill) return
          const delay = parseInt(fill.dataset.delay ?? '0')
          setTimeout(() => { fill.style.width = fill.dataset.revealWidth! }, delay)
          barObserver.unobserve(container)
        })
      },
      { threshold: 0.5 }
    )
    barContainers.forEach(el => barObserver.observe(el))

    return () => { fadeObserver.disconnect(); barObserver.disconnect() }
  }, [])

  return null
}
