import Nav from '@/components/Nav'
import Hero from '@/components/Hero'
import TrustBar from '@/components/TrustBar'
import HowItWorks from '@/components/HowItWorks'
import WhyElectric from '@/components/WhyElectric'
import NoiseComparison from '@/components/NoiseComparison'
import Testimonials from '@/components/Testimonials'
import MapQuoteBuilder from '@/components/MapQuoteBuilder'
import Footer from '@/components/Footer'

export default function Home() {
  return (
    <>
      <Nav />
      <Hero />
      <TrustBar />
      <HowItWorks />
      <WhyElectric />
      <NoiseComparison />
      <Testimonials />
      <MapQuoteBuilder />
      <Footer />
    </>
  )
}
