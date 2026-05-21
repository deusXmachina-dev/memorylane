import * as React from 'react'
import { useEffect, useState } from 'react'
import type { ActivityDigest, MainWindowAPI } from '@types'
import { PageLayout } from '../components/shell/PageLayout'
import { Digest } from '../components/activities/Digest'
import { AuditLog } from '../components/activities/AuditLog'

interface ActivitiesPageProps {
  api: MainWindowAPI
  onOpenPrivacy?: () => void
}

export function ActivitiesPage({ api, onOpenPrivacy }: ActivitiesPageProps): React.JSX.Element {
  const [digest, setDigest] = useState<ActivityDigest | null>(null)
  const [digestLoading, setDigestLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void api
      .getActivityDigest()
      .then((d) => {
        if (cancelled) return
        setDigest(d)
        setDigestLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setDigestLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [api])

  return (
    <PageLayout title="Activities">
      <Digest digest={digest} loading={digestLoading} onOpenPrivacy={onOpenPrivacy} />
      <AuditLog api={api} />
    </PageLayout>
  )
}
