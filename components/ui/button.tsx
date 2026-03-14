import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-none border text-[11px] font-medium uppercase tracking-[0.18em] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400/70 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border-sky-500/45 bg-sky-500/10 text-sky-100 hover:border-sky-400 hover:bg-sky-500/15",
        destructive:
          "border-rose-500/45 bg-rose-500/10 text-rose-100 hover:border-rose-400 hover:bg-rose-500/15",
        outline:
          "border-slate-700 bg-slate-950/65 text-slate-200 hover:border-slate-500 hover:text-white",
        secondary:
          "border-[#16417C]/70 bg-[#16417C]/18 text-slate-100 hover:border-sky-500/60 hover:bg-[#16417C]/28",
        success:
          "border-emerald-500/45 bg-emerald-500/10 text-emerald-100 hover:border-emerald-400 hover:bg-emerald-500/15",
        warning:
          "border-amber-500/45 bg-amber-500/10 text-amber-100 hover:border-amber-400 hover:bg-amber-500/15",
        ghost: "border-transparent bg-transparent text-slate-300 hover:border-slate-700 hover:bg-slate-900/80 hover:text-white",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 text-[10px] tracking-[0.16em]",
        lg: "h-11 px-6 py-2 text-xs",
        icon: "h-10 w-10 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  ref?: React.Ref<HTMLButtonElement>
}

function Button({
  className,
  variant,
  size,
  asChild = false,
  ref,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  )
}
Button.displayName = "Button"

export { Button, buttonVariants }
