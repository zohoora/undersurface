interface Ripple {
  id: number
  x: number
  y: number
}

interface Props {
  ripples: Ripple[]
}

export function PauseRipple({ ripples }: Props) {
  return (
    <>
      {ripples.map((r) => (
        <span
          key={r.id}
          className="pause-ripple"
          style={{ left: r.x, top: r.y }}
        />
      ))}
    </>
  )
}
