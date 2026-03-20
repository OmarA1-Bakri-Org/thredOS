'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { completeActivation } from '@/lib/ui/api'
import { useToast } from '@/components/ui/toast'

function extractActivationToken(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'thredos:') return null
    if (url.hostname !== 'activate' && url.pathname !== '/activate') return null
    return url.searchParams.get('token')
  } catch {
    return null
  }
}

export function DesktopRuntimeBridge() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const handledUrlsRef = useRef<Set<string>>(new Set())

  const handleActivationUrl = useCallback(async (rawUrl: string) => {
    if (!rawUrl || handledUrlsRef.current.has(rawUrl)) return
    handledUrlsRef.current.add(rawUrl)

    const token = extractActivationToken(rawUrl)
    if (!token) return

    try {
      const snapshot = await completeActivation(token)
      await queryClient.invalidateQueries({ queryKey: ['desktop-entitlement'] })
      toast({
        title: 'Desktop activated',
        description: snapshot.state.customerEmail
          ? `Activation completed for ${snapshot.state.customerEmail}.`
          : 'Activation completed and entitlement is now available locally.',
        variant: 'success',
      })
    } catch (error) {
      toast({
        title: 'Activation failed',
        description: error instanceof Error ? error.message : 'Unable to complete desktop activation.',
        variant: 'error',
      })
    }
  }, [queryClient, toast])

  useEffect(() => {
    const desktopApi = window.thredosDesktop
    if (!desktopApi) return

    void desktopApi.consumePendingActivationUrl().then(url => {
      if (url) {
        void handleActivationUrl(url)
      }
    })

    const unsubscribe = desktopApi.onActivationUrl((url) => {
      void handleActivationUrl(url)
    })

    return () => {
      unsubscribe?.()
    }
  }, [handleActivationUrl])

  return null
}
