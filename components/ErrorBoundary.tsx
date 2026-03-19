'use client'

import React from 'react'
import { Button } from '@/components/ui/button'

interface Props {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="flex h-full items-center justify-center bg-[#050913] p-6">
            <div className="w-full max-w-xl border border-slate-800/90 bg-[#08101d] px-6 py-6 text-left shadow-[0_28px_80px_rgba(0,0,0,0.45)]">
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">thredOS error boundary</div>
              <h2 className="mt-3 text-lg font-semibold text-white">Something went wrong</h2>
              <p className="mt-2 text-sm text-slate-300">
                {this.state.error?.message || 'An unexpected error occurred'}
              </p>
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => this.setState({ hasError: false })}
                className="mt-4"
              >
                Try again
              </Button>
            </div>
          </div>
        )
      )
    }

    return this.props.children
  }
}
