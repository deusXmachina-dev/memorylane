import { Button } from '@components/ui/button'
import { cn } from '@/renderer/lib/utils'

export interface SegmentedControlOption<T extends string> {
  value: T
  label: string
  disabled?: boolean
}

interface SegmentedControlProps<T extends string> {
  value: T
  options: SegmentedControlOption<T>[]
  onChange: (value: T) => void
  layout?: 'grid' | 'wrap'
  className?: string
  ariaLabel?: string
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  layout = 'grid',
  className,
  ariaLabel,
}: SegmentedControlProps<T>): React.JSX.Element {
  const isGrid = layout === 'grid'
  const containerClass = isGrid ? 'flex gap-2' : 'flex flex-wrap gap-1.5'
  return (
    <div role="group" aria-label={ariaLabel} className={cn(containerClass, className)}>
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={value === option.value ? 'default' : 'outline'}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          className={isGrid ? 'flex-1' : undefined}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}
