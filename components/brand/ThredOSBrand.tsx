import Image from 'next/image'
import { cn } from '@/lib/utils'

type ThredOSBrandProps = {
  className?: string
  imageClassName?: string
  labelClassName?: string
  subtitle?: string
  priority?: boolean
}

export function ThredOSBrand({
  className,
  imageClassName,
  labelClassName,
  subtitle,
  priority = false,
}: ThredOSBrandProps) {
  return (
    <div className={cn('flex items-end gap-4', className)}>
      <Image
        src="/thredos_mark_sym_flat.svg"
        alt="thredOS"
        width={72}
        height={72}
        priority={priority}
        className={cn('h-14 w-14 self-end object-contain', imageClassName)}
      />
      <div className={cn('min-w-0', labelClassName)}>
        <div className="text-xl font-semibold tracking-tight text-white">
          thred<span className="text-sky-300">OS</span>
        </div>
        {subtitle ? (
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-sky-300/65">
            {subtitle}
          </div>
        ) : null}
      </div>
    </div>
  )
}
