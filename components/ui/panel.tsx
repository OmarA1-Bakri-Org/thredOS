import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Panel — bordered rectangular surface used across the entry screen and
 * workbench. Replaces inline className soup at ProductEntryScreenClient
 * call sites and unblocks reuse inside the inspector/workbench later.
 *
 * The visual treatment per uiVariant lives on the theme object
 * (`getUiVariantTheme(uiVariant).entry.*`). Pass the theme class via
 * `themeClassName` to keep Panel theme-agnostic.
 */

const panelVariants = cva(
  'relative',
  {
    variants: {
      tone: {
        none: '',
        neutral: 'border border-slate-800/90 bg-[#08101d]',
        accent: 'border border-sky-500/30 bg-[#08101d]',
        emerald: 'border border-emerald-500/25 bg-emerald-500/5',
      },
      padding: {
        none: '',
        sm: 'px-3 py-3',
        md: 'px-4 py-4',
        lg: 'px-5 py-5',
        xl: 'p-8',
      },
      elevation: {
        none: '',
        overlay: 'shadow-[0_28px_80px_rgba(0,0,0,0.45)]',
      },
    },
    defaultVariants: {
      tone: 'neutral',
      padding: 'md',
      elevation: 'none',
    },
  },
)

export type PanelProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof panelVariants> & {
    /**
     * Theme-provided className (e.g. `getUiVariantTheme(v).entry.diagramPanel`).
     * Applied AFTER variant classes so theme overrides win where needed.
     */
    themeClassName?: string
    ref?: React.Ref<HTMLDivElement>
  }

export function Panel({
  className,
  themeClassName,
  tone,
  padding,
  elevation,
  ref,
  ...rest
}: PanelProps) {
  return (
    <div
      ref={ref}
      className={cn(panelVariants({ tone, padding, elevation }), themeClassName, className)}
      {...rest}
    />
  )
}
Panel.displayName = 'Panel'

export { panelVariants }
