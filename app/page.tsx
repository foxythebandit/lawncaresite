import ScrollReveal from '@/components/ScrollReveal'
import Nav from '@/components/Nav'
import Hero from '@/components/Hero'
import TrustBar from '@/components/TrustBar'
import HowItWorks from '@/components/HowItWorks'
import WhyElectric from '@/components/WhyElectric'
import Testimonials from '@/components/Testimonials'
import FAQ from '@/components/FAQ'
import MapQuoteBuilder from '@/components/MapQuoteBuilder'
import IncludedBand from '@/components/IncludedBand'
import Footer from '@/components/Footer'

export default function Home() {
  return (
    <>
      <ScrollReveal />
      <Nav />
      <Hero />
      <TrustBar />
      <MapQuoteBuilder />
      <IncludedBand />
      <Testimonials />
      <HowItWorks />
      <WhyElectric />
      <FAQ />
      <Footer />
    </>
  )
}
