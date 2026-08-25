import Link from 'next/link'

export default function AppBottomBar() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-3 backdrop-blur-xl">
      <div className="mx-auto grid max-w-[430px] grid-cols-5 items-end text-center text-[11px] text-slate-800">
        <Link href="/albums" className="text-gold-deep">
          <div className="mx-auto mb-1 text-2xl">▰</div>
          <p>หน้าหลัก</p>
        </Link>

        <button className="opacity-90">
          <div className="mx-auto mb-1 text-2xl">▱</div>
          <p>งานของฉัน</p>
        </button>

        <button className="opacity-90">
          <div className="mx-auto mb-1 text-2xl">✦</div>
          <p>อัปโหลด</p>
        </button>

        <button className="opacity-90">
          <div className="mx-auto mb-1 text-2xl">♢</div>
          <p>แจ้งเตือน</p>
        </button>

        <button className="opacity-90">
          <div className="mx-auto mb-1 text-2xl">♡</div>
          <p>โปรไฟล์</p>
        </button>
      </div>
    </nav>
  )
}
