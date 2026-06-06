type Props = {
  name: string
  size?: number
  className?: string
}

export default function AppIcon({
  name,
  size = 24,
  className = '',
}: Props) {
  return (
    <img
      src={`/icons/${name}.svg`}
      alt={name}
      width={size}
      height={size}
      className={`object-contain ${className}`}
    />
  )
}