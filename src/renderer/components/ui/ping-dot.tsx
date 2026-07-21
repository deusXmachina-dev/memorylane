/** Small status dot; pulses while active, static and muted otherwise. */
export function PingDot({ active = true }: { active?: boolean }): React.JSX.Element {
  return (
    <span className="relative inline-flex size-2 shrink-0">
      {active && (
        <span className="absolute inset-0 animate-ping rounded-full bg-primary opacity-75" />
      )}
      <span
        className={`relative inline-flex size-2 rounded-full ${active ? 'bg-primary' : 'bg-muted-foreground'}`}
      />
    </span>
  )
}
