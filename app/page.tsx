import ScrollReveal from '@/components/ScrollReveal'
import Nav from '@/components/Nav'
import Hero from '@/components/Hero'
import TrustBar from '@/components/TrustBar'
import HowItWorks from '@/components/HowItWorks'
import WhyElectric from '@/components/WhyElectric'
import NoiseComparison from '@/components/NoiseComparison'
import Testimonials from '@/components/Testimonials'
import FAQ from '@/components/FAQ'
import MapQuoteBuilder from '@/components/MapQuoteBuilder'
import WaveDivider from '@/components/WaveDivider'
import Footer from '@/components/Footer'

export default function Home() {
  return (
    <>
      <ScrollReveal />
      <Nav />
      <Hero />
      <TrustBar />
      <MapQuoteBuilder />
      <WaveDivider from="#1a3a2a" to="#f7f6f2" />
      <HowItWorks />
      <WaveDivider from="#f7f6f2" to="#1a3a2a" />
      <WhyElectric />
      <WaveDivider from="#1a3a2a" to="#f7f6f2" />
      <NoiseComparison />
      <WaveDivider from="#f7f6f2" to="#f0faf4" />
      <Testimonials />
      <WaveDivider from="#f0faf4" to="#f7f6f2" />
      <FAQ />
      <Footer />
    </>
  )
}
