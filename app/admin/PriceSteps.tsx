import { priceSteps, type Price } from '@/lib/lead-summary'

/** Full price → plan discount → first visit, each with its dollar result. Lead page and Jobs share it. */
export default function PriceSteps({ price, firstVisit = true }: { price: Price; firstVisit?: boolean }) {
  return <dl className="crm-kv crm-price-steps">
    {priceSteps(price, { firstVisit }).map(step => <div key={step.key} data-step={step.key}>
      <dt>{step.label}{step.off && <> <span className={`crm-pill crm-pill-${step.key === 'first' ? 'ok' : 'neutral'}`}>{step.off}</span></>}</dt>
      <dd><strong>{step.amount}</strong>{step.unit && <small> {step.unit}</small>}</dd>
    </div>)}
  </dl>
}
