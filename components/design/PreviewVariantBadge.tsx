import { cn } from '@/lib/utils'
import { getUiVariantOption, getUiVariantTheme, type UiVariant } from '@/lib/ui/design-variants'

export function PreviewVariantBadge({
  uiVariant,
  previewMode,
  className,
  tone = 'entry',
}: {
  uiVariant: UiVariant
  previewMode?: boolean
  className?: string
  tone?: 'entry' | 'auth' | 'workbench'
}) {
  if (!previewMode) return null

  const option = getUiVariantOption(uiVariant)
  const theme = getUiVariantTheme(uiVariant)
  const badgeClass = tone === 'auth'
    ? theme.auth.previewBadge
    : tone === 'workbench'
      ? theme.workbench.previewBadge
      : theme.entry.previewBadge

  return (
    <span
      data-testid="ui-variant-badge"
      className={cn(
        'rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]',
        badgeClass,
        className,
      )}
    >
      Preview {option.code} · {option.label}
    </span>
  )
}
