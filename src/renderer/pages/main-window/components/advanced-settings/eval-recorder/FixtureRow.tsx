import { CheckCircleIcon, ExportIcon, TrashIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { Button } from '@components/ui/button'
import type { EvalFixtureSummary } from '@/shared/eval-review'

export function FixtureRow({
  fixture,
  onOpen,
  onExport,
  onDelete,
}: {
  fixture: EvalFixtureSummary
  onOpen: (name: string) => void
  onExport: (name: string) => void
  onDelete: (name: string) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 py-2">
      <button type="button" onClick={() => onOpen(fixture.name)} className="flex-1 text-left">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          {fixture.scriptFollowed === true && <CheckCircleIcon className="size-4 text-primary" />}
          {fixture.scriptFollowed === false && (
            <WarningCircleIcon className="size-4 text-destructive" />
          )}
          {new Date(fixture.capturedAt).toLocaleString()}
        </div>
        <div className="text-xs text-muted-foreground">
          {fixture.frameCount} frames · {fixture.appMix.slice(0, 3).join(', ') || 'no apps'}
          {fixture.hasVideo ? '' : ' · no video'}
        </div>
      </button>
      <Button variant="ghost" size="sm" onClick={() => onExport(fixture.name)}>
        <ExportIcon /> Export
      </Button>
      <Button variant="ghost" size="sm" onClick={() => onDelete(fixture.name)}>
        <TrashIcon /> Delete
      </Button>
    </div>
  )
}
