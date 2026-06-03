interface Props {
  from: string
  to: string
  flip?: boolean
}

export default function WaveDivider({ from, to, flip }: Props) {
  return (
    <div style={{ background: from, lineHeight: 0, display: 'block', marginBottom: -2 }}>
      <svg
        viewBox="0 0 1440 72"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="none"
        style={{
          display: 'block',
          width: '100%',
          transform: flip ? 'scaleY(-1)' : undefined,
        }}
        height="72"
      >
        <path
          d="M0 36 C240 72 480 0 720 36 C960 72 1200 12 1440 36 L1440 72 L0 72 Z"
          fill={to}
        />
      </svg>
    </div>
  )
}
