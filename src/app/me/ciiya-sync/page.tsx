import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, FolderSync, ShieldCheck } from 'lucide-react'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getLocale } from '@/lib/i18n-server'
import CiiyaSyncDevices, {
  type CiiyaSyncDeviceListItem,
} from '@/components/ciiya-sync-devices'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function CiiyaSyncDevicesPage() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login?next=/me/ciiya-sync')

  const locale = await getLocale()
  const { data, error } = await supabase
    .from('ciiya_sync_devices')
    .select(
      'id,client_device_id,name,platform,app_version,scopes,token_expires_at,last_seen_at,revoked_at,created_at,updated_at'
    )
    .eq('owner_id', user.id)
    .order('updated_at', { ascending: false })

  return (
    <main className="min-h-screen bg-ground px-4 pb-16 pt-6 text-ink sm:px-6 sm:pt-10">
      <div className="mx-auto w-full max-w-[720px]">
        <Link
          href="/me"
          className="inline-flex min-h-11 items-center gap-2 rounded-full px-2 text-[13px] font-medium text-muted transition hover:text-ink"
        >
          <ArrowLeft size={17} strokeWidth={1.7} aria-hidden />
          {locale === 'th' ? 'กลับไปหน้า Me' : 'Back to Me'}
        </Link>

        <header className="mt-5 rounded-[30px] bg-ink px-6 py-7 text-white sm:px-8 sm:py-9">
          <div className="flex items-start justify-between gap-5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.17em] text-gold">
                CIIYA SYNC
              </p>
              <h1 className="mt-3 text-[32px] font-medium leading-none tracking-[-0.045em] sm:text-[40px]">
                {locale === 'th' ? 'อุปกรณ์ที่เชื่อมต่อ' : 'Connected devices'}
              </h1>
              <p className="mt-4 max-w-[500px] text-[13px] leading-6 text-white/65 sm:text-[14px]">
                {locale === 'th'
                  ? 'ดูคอมพิวเตอร์ที่เข้าถึงอัลบั้มผ่าน Ciiya Sync และตัดการเชื่อมต่อเครื่องที่ไม่ต้องการได้ทันที'
                  : 'Review computers connected through Ciiya Sync and immediately revoke any device you no longer use.'}
              </p>
            </div>
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/10 text-gold">
              <FolderSync size={22} strokeWidth={1.6} aria-hidden />
            </span>
          </div>
        </header>

        <section className="my-4 flex items-start gap-3 rounded-[22px] border border-line bg-gold-soft/60 px-4 py-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-gold-deep" strokeWidth={1.7} aria-hidden />
          <p className="text-[12px] leading-5 text-muted">
            {locale === 'th'
              ? 'อุปกรณ์จะเห็นเฉพาะอัลบั้มของบัญชีนี้และไม่มีสิทธิ์เข้าถึง R2 Secret หรือ Supabase Service Role การตัดการเชื่อมต่อมีผลกับคำขอใหม่ทันที'
              : 'Devices can only access this account’s albums and never receive R2 or Supabase service credentials. Disconnecting blocks new requests immediately.'}
          </p>
        </section>

        {error ? (
          <section className="rounded-[24px] border border-red-100 bg-red-50 px-5 py-6 text-[13px] leading-6 text-red-600">
            {locale === 'th'
              ? 'ยังโหลดรายการอุปกรณ์ไม่ได้ กรุณาตรวจสอบว่าได้ติดตั้ง Migration ของ Ciiya Sync แล้ว'
              : 'Devices could not be loaded. Confirm that the Ciiya Sync migration has been applied.'}
          </section>
        ) : (
          <CiiyaSyncDevices
            initialDevices={(data || []) as CiiyaSyncDeviceListItem[]}
            locale={locale}
          />
        )}
      </div>
    </main>
  )
}
