'use client'

type Props = {
  onClick?: () => void
}

export default function FaceSearchButton({ onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="
        fixed bottom-24 right-5 z-50
        flex items-center gap-2
        rounded-full
        bg-black px-5 py-3
        text-sm font-medium text-white
        shadow-xl
        transition hover:scale-105
      "
    >
      <span>🔍</span>
      <span>Face Search</span>
    </button>
  )
}