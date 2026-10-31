import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'QuietGreen — Electric Lawn Care',
    short_name: 'QuietGreen',
    start_url: '/',
    display: 'browser',
    background_color: '#f7f6f2',
    theme_color: '#1a3a2a',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
