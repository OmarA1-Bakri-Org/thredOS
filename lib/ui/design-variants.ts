export type UiVariant = 'operator-minimalism' | 'premium-control' | 'industrial-systems'

type QueryValue = string | string[] | undefined | null

export interface UiVariantOption {
  id: UiVariant
  code: 'A' | 'B' | 'C'
  label: string
  summary: string
}

export interface UiVariantTheme extends UiVariantOption {
  entry: {
    root: string
    hero: string
    primaryPanel: string
    secondaryPanel: string
    diagramFrame: string
    diagramPanel: string
    diagramAccentText: string
    diagramBadge: string
    previewBadge: string
  }
  auth: {
    root: string
    primaryPanel: string
    secondaryPanel: string
    previewBadge: string
  }
  workbench: {
    shell: string
    topBarRegion: string
    board: string
    drawerBackdrop: string
    drawerPanel: string
    clusterSurface: string
    searchSurface: string
    statusPill: string
    previewBadge: string
  }
}

export const UI_VARIANT_OPTIONS: UiVariantOption[] = [
  {
    id: 'operator-minimalism',
    code: 'A',
    label: 'Operator Minimalism',
    summary: 'Quiet, high-trust desktop UI with tight spacing and low visual flourish.',
  },
  {
    id: 'premium-control',
    code: 'B',
    label: 'Premium Control Surface',
    summary: 'A more assertive brand frame with stronger contrast and a richer shell presence.',
  },
  {
    id: 'industrial-systems',
    code: 'C',
    label: 'Industrial Systems UI',
    summary: 'Sharper grid, stronger labels, and a more infrastructural control-room tone.',
  },
]

const UI_VARIANT_THEMES: Record<UiVariant, UiVariantTheme> = {
  'operator-minimalism': {
    ...UI_VARIANT_OPTIONS[0],
    entry: {
      root: 'bg-[#060a12]',
      hero: 'border border-[#16417C]/55 bg-[#08101d]',
      primaryPanel: 'border border-sky-500/30 bg-[#08101d]',
      secondaryPanel: 'border border-slate-800/90 bg-[#08101d]',
      diagramFrame: 'border border-sky-500/20 bg-[#06111e]',
      diagramPanel: 'border border-slate-800/90 bg-[#08111f]',
      diagramAccentText: 'text-sky-300/75',
      diagramBadge: 'border border-sky-500/30 bg-sky-500/10 text-sky-100',
      previewBadge: 'border border-sky-500/35 bg-sky-500/10 text-sky-100',
    },
    auth: {
      root: 'bg-[#060a12]',
      primaryPanel: 'border border-slate-800/90 bg-[#08101d]',
      secondaryPanel: 'border border-slate-800/90 bg-[#08101d]',
      previewBadge: 'border border-sky-500/35 bg-sky-500/10 text-sky-100',
    },
    workbench: {
      shell: 'bg-[#060a12] text-slate-100',
      topBarRegion: 'border-slate-800/80 bg-[#08101d]',
      board: 'bg-[#050913]',
      drawerBackdrop: 'bg-[#02050a]/52',
      drawerPanel: 'border-r border-slate-800/80 bg-[#08101d]',
      clusterSurface: 'border-slate-800 bg-[#0a101a]',
      searchSurface: 'border-slate-800 bg-[#0a101a] text-slate-300',
      statusPill: 'border-[#16417C]/70 bg-[#16417C]/18 text-slate-100',
      previewBadge: 'border border-sky-500/35 bg-sky-500/10 text-sky-100',
    },
  },
  'premium-control': {
    ...UI_VARIANT_OPTIONS[1],
    entry: {
      root: 'bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.18),transparent_28%),radial-gradient(circle_at_18%_24%,rgba(59,130,246,0.18),transparent_24%),linear-gradient(180deg,#020611_0%,#07111f_38%,#03060d_100%)]',
      hero: 'border border-cyan-300/30 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),transparent_44%),linear-gradient(180deg,#081326_0%,#050b17_100%)]',
      primaryPanel: 'border border-cyan-300/40 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),transparent_42%),linear-gradient(180deg,#081326_0%,#050d1a_100%)]',
      secondaryPanel: 'border border-cyan-300/18 bg-[linear-gradient(180deg,#09111f_0%,#07101b_100%)]',
      diagramFrame: 'border border-cyan-300/35 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,0.18),transparent_38%),linear-gradient(180deg,#081426_0%,#050b17_100%)]',
      diagramPanel: 'border border-cyan-300/16 bg-[#07101d]/95',
      diagramAccentText: 'text-cyan-100/72',
      diagramBadge: 'border border-cyan-300/60 bg-cyan-300/12 text-cyan-50',
      previewBadge: 'border border-cyan-300/60 bg-cyan-300/12 text-cyan-50',
    },
    auth: {
      root: 'bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.18),transparent_34%),linear-gradient(180deg,#040913_0%,#07111f_38%,#040811_100%)]',
      primaryPanel: 'border border-cyan-300/25 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.18),transparent_42%),linear-gradient(180deg,rgba(8,19,38,0.96)_0%,rgba(5,12,25,0.98)_100%)]',
      secondaryPanel: 'border border-cyan-300/25 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.12),transparent_38%),linear-gradient(180deg,rgba(8,19,38,0.96)_0%,rgba(5,12,25,0.98)_100%)]',
      previewBadge: 'border border-cyan-300/40 bg-cyan-300/10 text-cyan-50',
    },
    workbench: {
      shell: 'bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.08),transparent_35%),linear-gradient(180deg,#040912_0%,#050b16_100%)] text-slate-100',
      topBarRegion: 'border-cyan-300/14 bg-[linear-gradient(180deg,rgba(8,19,38,0.98),rgba(5,12,25,0.98))]',
      board: 'bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.06),transparent_28%),linear-gradient(180deg,#040810_0%,#050913_100%)]',
      drawerBackdrop: 'bg-[#02050a]/72',
      drawerPanel: 'border-r border-cyan-300/18 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.18),transparent_36%),linear-gradient(180deg,rgba(8,19,38,0.98),rgba(5,12,25,0.99))]',
      clusterSurface: 'border-cyan-300/18 bg-[linear-gradient(180deg,rgba(8,19,38,0.96),rgba(5,12,25,0.98))]',
      searchSurface: 'border-cyan-300/22 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.18),transparent_48%),linear-gradient(180deg,rgba(8,19,38,0.98),rgba(5,12,25,0.98))] text-cyan-50/86',
      statusPill: 'border-cyan-300/35 bg-cyan-300/12 text-cyan-50',
      previewBadge: 'border border-cyan-300/60 bg-cyan-300/12 text-cyan-50',
    },
  },
  'industrial-systems': {
    ...UI_VARIANT_OPTIONS[2],
    entry: {
      root: 'bg-[linear-gradient(180deg,#05070b_0%,#06080d_100%)]',
      hero: 'border border-amber-500/15 bg-[#0a0e14]',
      primaryPanel: 'border border-amber-500/18 bg-[#0a0e14]',
      secondaryPanel: 'border border-slate-800/90 bg-[#0a0d12]',
      diagramFrame: 'border border-amber-500/15 bg-[#081016]',
      diagramPanel: 'border border-slate-800 bg-[#0a0e14]',
      diagramAccentText: 'text-amber-200/75',
      diagramBadge: 'border border-amber-400/35 bg-amber-500/10 text-amber-100',
      previewBadge: 'border border-amber-400/35 bg-amber-500/10 text-amber-100',
    },
    auth: {
      root: 'bg-[linear-gradient(180deg,#05070b_0%,#06080d_100%)]',
      primaryPanel: 'border border-amber-500/15 bg-[#0a0d12]',
      secondaryPanel: 'border border-slate-800/90 bg-[#0a0d12]',
      previewBadge: 'border border-amber-400/35 bg-amber-500/10 text-amber-100',
    },
    workbench: {
      shell: 'bg-[#05070b] text-slate-100',
      topBarRegion: 'border-amber-500/15 bg-[#0a0d12]',
      board: 'bg-[#05070a]',
      drawerBackdrop: 'bg-[#010203]/60',
      drawerPanel: 'border-r border-amber-500/15 bg-[#0a0d12]',
      clusterSurface: 'border-slate-700 bg-[#0c1016]',
      searchSurface: 'border-amber-500/15 bg-[#090c11] text-slate-200',
      statusPill: 'border-amber-500/25 bg-amber-500/8 text-amber-50',
      previewBadge: 'border border-amber-400/35 bg-amber-500/10 text-amber-100',
    },
  },
}

export function takeFirstQueryValue(value: QueryValue, fallback = ''): string {
  if (Array.isArray(value)) return value[0] ?? fallback
  return value ?? fallback
}

export function resolveUiVariant(value: QueryValue): UiVariant {
  const normalized = takeFirstQueryValue(value).trim()
  if (normalized === 'premium-control' || normalized === 'industrial-systems' || normalized === 'operator-minimalism') {
    return normalized
  }
  return 'premium-control'
}

export function resolvePreviewMode(value: QueryValue): boolean {
  const normalized = takeFirstQueryValue(value).trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'preview'
}

export function getUiVariantTheme(variant: UiVariant): UiVariantTheme {
  return UI_VARIANT_THEMES[variant]
}

export function getUiVariantOption(variant: UiVariant): UiVariantOption {
  return UI_VARIANT_THEMES[variant]
}

export function buildEntryPreviewHref(variant: UiVariant): string {
  return `/?uiVariant=${variant}&preview=1`
}

export function buildWorkbenchPreviewHref(variant: UiVariant): string {
  return `/app?uiVariant=${variant}&preview=1`
}

export function buildLoginPreviewHref(variant: UiVariant): string {
  const next = encodeURIComponent(buildWorkbenchPreviewHref(variant))
  return `/login?uiVariant=${variant}&preview=1&next=${next}`
}
