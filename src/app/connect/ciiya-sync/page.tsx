import { redirect } from 'next/navigation'
import CiiyaSyncConnectForm from '@/components/ciiya-sync-connect-form'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export default async function CiiyaSyncConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>
}) {
  const query = await searchParams
  const initialCode = typeof query.code === 'string' ? query.code : ''
  const nextPath = `/connect/ciiya-sync${
    initialCode ? `?code=${encodeURIComponent(initialCode)}` : ''
  }`
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`)
  }

  return (
    <main className="min-h-screen bg-ground px-5 py-10 text-ink sm:py-16">
      <div className="mx-auto w-full max-w-[520px]">
        <header className="mb-7">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-deep">
            CIIYA SYNC
          </p>
          <h1 className="mt-3 text-[34px] font-medium leading-[1.06] tracking-[-0.045em] sm:text-[42px]">
            เชื่อม Lightroom
            <br />กับอัลบั้ม Ciiya
          </h1>
          <p className="mt-4 max-w-[440px] text-[14px] leading-6 text-muted">
            ตรวจสอบรหัสจากแอป Ciiya Sync ก่อนอนุญาตคอมพิวเตอร์เครื่องนี้
            การเชื่อมต่อมีอายุจำกัดและเพิกถอนได้
          </p>
        </header>

        <CiiyaSyncConnectForm initialCode={initialCode} />
      </div>
    </main>
  )
}
