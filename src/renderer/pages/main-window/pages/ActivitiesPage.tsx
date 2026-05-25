import * as React from 'react'
import { useEffect } from 'react'
import type { ActivitiesData } from '@/renderer/hooks/use-activities-data'
import { PageLayout } from '../components/shell/PageLayout'
import { Digest } from '../components/activities/Digest'
import { AuditLog } from '../components/activities/AuditLog'

interface ActivitiesPageProps {
  activities: ActivitiesData
  onOpenPrivacy?: () => void
}

export function ActivitiesPage({
  activities,
  onOpenPrivacy,
}: ActivitiesPageProps): React.JSX.Element {
  const { ensureLoaded } = activities
  useEffect(() => {
    ensureLoaded()
  }, [ensureLoaded])

  return (
    <PageLayout title="Activities">
      <Digest
        digest={activities.digest}
        loading={activities.loading}
        onOpenPrivacy={onOpenPrivacy}
        onSelectApp={activities.setAppFilter}
        onSelectTld={activities.setTldFilter}
        activeApp={activities.appFilter}
        activeTld={activities.tldFilter}
      />
      <AuditLog activities={activities} />
    </PageLayout>
  )
}
