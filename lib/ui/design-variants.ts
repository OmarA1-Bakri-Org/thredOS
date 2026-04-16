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
      root: 'bg-[radial-gradient(circle_at_top,rgba(168,85,247,0.16),transparent_34%),#050812]',
      hero: 'border border-fuchsia-500/25 bg-[#0b1020]',
      primaryPanel: 'border border-fuchsia-500/25 bg-[linear-gradient(180deg,rgba(16,24,40,0.98),rgba(8,12,24,0.98))]',
      secondaryPanel: 'border border-sky-500/15 bg-[#09111f]',
      diagramFrame: 'border border-fuchsia-500/20 bg-[#08101e]',
      diagramPanel: 'border border-fuchsia-500/15 bg-[#0b1324]',
      diagramAccentText: 'text-fuchsia-200/80',
      diagramBadge: 'border border-fuchsia-400/35 bg-fuchsia-500/10 text-fuchsia-100',
      previewBadge: 'border border-fuchsia-400/35 bg-fuchsia-500/10 text-fuchsia-100',
    },
    auth: {
      root: 'bg-[radial-gradient(circle_at_top,rgba(168,85,247,0.16),transparent_30%),#050812]',
      primaryPanel: 'border border-fuchsia-500/20 bg-[#0b1020]',
      secondaryPanel: 'border border-sky-500/15 bg-[#09111f]',
      previewBadge: 'border border-fuchsia-400/35 bg-fuchsia-500/10 text-fuchsia-100',
    },
    workbench: {
      shell: 'bg-[radial-gradient(circle_at_top,rgba(168,85,247,0.12),transparent_28%),#060812] text-slate-100',
      topBarRegion: 'border-fuchsia-500/15 bg-[#0b1020]',
      board: 'bg-[#050814]',
      drawerBackdrop: 'bg-[#02040b]/60',
      drawerPanel: 'border-r border-fuchsia-500/15 bg-[#0b1122]',
      clusterSurface: 'border-fuchsia-500/15 bg-[#0b1120]',
      searchSurface: 'border-fuchsia-500/15 bg-[#09101d] text-slate-200',
      statusPill: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-50',
      previewBadge: 'border border-fuchsia-400/35 bg-fuchsia-500/10 text-fuchsia-100',
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
  return 'operator-minimalism'
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
