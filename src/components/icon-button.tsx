'use client'

import AppIcon from '@/components/app-icon'

type Variant = 'white' | 'blue' | 'red' | 'ghost' | 'dark'
type Size = 'sm' | 'md' | 'lg'

type Props = {
  icon?: string
  label?: string
  title?: string
  loading?: boolean
  disabled?: boolean
  type?: 'button' | 'submit' | 'reset'
  variant?: Variant
  size?: Size
  className?: string
  iconClassName?: string
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
}

const sizeClass: Record<Size, string> = {
  sm: 'h-8 min-w-8 px-2 text-xs',
  md: 'h-9 min-w-9 px-3 text-sm',
  lg: 'h-11 min-w-11 px-4 text-base',
}

const iconSize: Record<Size, number> = {
  sm: 16,
  md: 18,
  lg: 22,
}

const variantClass: Record<Variant, string> = {
  white:
    'bg-white/90 text-ink-soft shadow-sm ring-1 ring-black/5 hover:bg-white',
  blue: 'bg-[#2F6BFF] text-white shadow-sm hover:bg-[#2458d8]',
  red: 'bg-red-50 text-red-600 shadow-sm ring-1 ring-red-100 hover:bg-red-100',
  ghost: 'bg-transparent text-ink-soft hover:bg-ground-sunken',
  dark: 'bg-black/70 text-white shadow-sm hover:bg-black/80',
}

export default function IconButton({
  icon,
  label,
  title,
  loading = false,
  disabled = false,
  type = 'button',
  variant = 'white',
  size = 'md',
  className = '',
  iconClassName = '',
  onClick,
}: Props) {
  const hasLabel = Boolean(label)

  return (
    <button
      type={type}
      title={title || label || icon}
      aria-label={title || label || icon || 'button'}
      onClick={onClick}
      disabled={disabled || loading}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition active:scale-95 disabled:pointer-events-none disabled:opacity-50',
        sizeClass[size],
        variantClass[variant],
        hasLabel ? '' : 'px-0',
        className,
      ].join(' ')}
    >
      {loading ? (
        <span className="leading-none">…</span>
      ) : icon ? (
        <AppIcon
          name={icon}
          size={iconSize[size]}
          className={iconClassName}
        />
      ) : null}

      {label ? <span>{label}</span> : null}
    </button>
  )
}