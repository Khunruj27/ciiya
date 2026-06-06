'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'
import AppIcon from '@/components/app-icon'

const PROVINCES_BY_REGION: Record<string, string[]> = {
  'ภาคเหนือ': [
    'เชียงใหม่',
    'เชียงราย',
    'ลำปาง',
    'ลำพูน',
    'แม่ฮ่องสอน',
    'น่าน',
    'พะเยา',
    'แพร่',
    'อุตรดิตถ์',
    'พิษณุโลก',
    'สุโขทัย',
    'ตาก',
    'เพชรบูรณ์',
    'พิจิตร',
    'กำแพงเพชร',
    'นครสวรรค์',
    'อุทัยธานี',
  ],
  'ภาคกลาง': [
    'กรุงเทพมหานคร',
    'นนทบุรี',
    'ปทุมธานี',
    'พระนครศรีอยุธยา',
    'อ่างทอง',
    'ลพบุรี',
    'สิงห์บุรี',
    'ชัยนาท',
    'สระบุรี',
    'นครปฐม',
    'สมุทรปราการ',
    'สมุทรสาคร',
    'สมุทรสงคราม',
  ],
  'ภาคตะวันออก': [
    'ชลบุรี',
    'ระยอง',
    'จันทบุรี',
    'ตราด',
    'ฉะเชิงเทรา',
    'ปราจีนบุรี',
    'สระแก้ว',
    'นครนายก',
  ],
  'ภาคตะวันตก': [
    'กาญจนบุรี',
    'ราชบุรี',
    'เพชรบุรี',
    'ประจวบคีรีขันธ์',
    'สุพรรณบุรี',
  ],
  'ภาคตะวันออกเฉียงเหนือ': [
    'นครราชสีมา',
    'ขอนแก่น',
    'อุบลราชธานี',
    'อุดรธานี',
    'บุรีรัมย์',
    'สุรินทร์',
    'ศรีสะเกษ',
    'ร้อยเอ็ด',
    'มหาสารคาม',
    'กาฬสินธุ์',
    'สกลนคร',
    'นครพนม',
    'มุกดาหาร',
    'หนองคาย',
    'บึงกาฬ',
    'เลย',
    'หนองบัวลำภู',
    'ชัยภูมิ',
    'ยโสธร',
    'อำนาจเจริญ',
  ],
  'ภาคใต้': [
    'นครศรีธรรมราช',
    'สุราษฎร์ธานี',
    'ภูเก็ต',
    'กระบี่',
    'พังงา',
    'ระนอง',
    'ชุมพร',
    'สงขลา',
    'สตูล',
    'ตรัง',
    'พัทลุง',
    'ปัตตานี',
    'ยะลา',
    'นราธิวาส',
  ],
}

const REGIONS = Object.keys(PROVINCES_BY_REGION)

export default function EditProfilePage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [region, setRegion] = useState('')
  const [province, setProvince] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [initializing, setInitializing] = useState(true)
  const [message, setMessage] = useState('')

  const provinceOptions = region ? PROVINCES_BY_REGION[region] || [] : []

  useEffect(() => {
    async function loadUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push('/login')
        return
      }

      const displayName =
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        'User Name'

      const currentAvatar =
        user.user_metadata?.avatar_url ||
        user.user_metadata?.picture ||
        null

      const currentRegion = user.user_metadata?.region || ''
      const currentProvince = user.user_metadata?.province || ''

      setName(displayName)
      setEmail(user.email || '')
      setRegion(currentRegion)
      setProvince(currentProvince)
      setAvatarUrl(currentAvatar)
      setPreviewUrl(currentAvatar)
      setInitializing(false)
    }

    loadUser()
  }, [router, supabase])

  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [previewUrl])

  function handleSelectAvatar(file: File | null) {
  setMessage('')

  if (!file) {
    setAvatarFile(null)

    if (previewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl)
    }

    setPreviewUrl(avatarUrl)
    return
  }

  if (!file.type.startsWith('image/')) {
    setMessage('Please choose an image file')
    return
  }

  if (file.size > 10 * 1024 * 1024) {
    setMessage('Image must be smaller than 10MB')
    return
  }

  if (previewUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(previewUrl)
  }

  setAvatarFile(file)
  setPreviewUrl(URL.createObjectURL(file))
}

  async function resizeAvatar(file: File): Promise<Blob> {
    const image = new Image()
    const url = URL.createObjectURL(file)

    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = reject
      image.src = url
    })

    const size = 800
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size

    const ctx = canvas.getContext('2d')

    if (!ctx) {
      throw new Error('Cannot resize image')
    }

    const scale = Math.max(size / image.width, size / image.height)
    const width = image.width * scale
    const height = image.height * scale
    const x = (size - width) / 2
    const y = (size - height) / 2

    ctx.drawImage(image, x, y, width, height)
    URL.revokeObjectURL(url)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Cannot convert image'))
            return
          }

          resolve(blob)
        },
        'image/webp',
        0.82
      )
    })
  }

  async function uploadAvatar(userId: string) {
    if (!avatarFile) return avatarUrl

    const resizedBlob = await resizeAvatar(avatarFile)
    const path = `${userId}/profile-${Date.now()}.webp`

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, resizedBlob, {
        contentType: 'image/webp',
        upsert: true,
      })

    if (uploadError) {
      throw new Error(uploadError.message)
    }

    const { data } = supabase.storage.from('avatars').getPublicUrl(path)

    return data.publicUrl
  }

  async function handleSave() {
    try {
      setLoading(true)
      setMessage('')

      const { data: sessionData } = await supabase.auth.getSession()

      let user = sessionData.session?.user || null

      if (!user) {
        const userResult = await supabase.auth.getUser()
        user = userResult.data.user
      }

      if (!user) {
  setMessage('Session expired. Please login again.')
  setLoading(false)
  router.replace('/login')
  return
}

      const nextName = name.trim()

      if (!nextName) {
  setMessage('Please enter your name')
  setLoading(false)
  return
}

      const nextAvatarUrl = await uploadAvatar(user.id)
      const currentMetadata = user.user_metadata || {}

      const { error } = await supabase.auth.updateUser({
        data: {
          ...currentMetadata,
          full_name: nextName,
          name: nextName,
          region,
          province,
          avatar_url:
            nextAvatarUrl ||
            currentMetadata.avatar_url ||
            currentMetadata.picture ||
            null,
          picture:
            nextAvatarUrl ||
            currentMetadata.picture ||
            currentMetadata.avatar_url ||
            null,
        },
      })

      if (error) {
        setMessage(error.message)
        return
      }

      await supabase.auth.refreshSession()
      router.replace(`/me?updated=${Date.now()}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Update failed')
    } finally {
      setLoading(false)
    }
  }

  if (initializing) {
    return (
     <main className="min-h-screen bg-[#F5F5F7] px-5 pt-[max(60px,env(safe-area-inset-top))] pb-[max(40px,env(safe-area-inset-bottom))] text-black">
       <div className="ciiya-safe-container">
          <div className="flex items-center justify-between px-2">
            <div className="h-14 w-14 rounded-full bg-white shadow-[0_12px_35px_rgba(15,23,42,0.06)]" />
            <div className="h-6 w-32 rounded-full bg-white" />
            <div className="h-14 w-14" />
          </div>

          <section className="mt-10 flex flex-col items-center">
            <div className="h-36 w-36 rounded-full bg-white shadow-[0_16px_45px_rgba(15,23,42,0.06)]" />
            <div className="mt-6 h-10 w-52 rounded-full bg-white" />
            <div className="mt-3 h-6 w-64 rounded-full bg-white" />
            <div className="mt-5 h-12 w-36 rounded-full bg-white" />
          </section>

          <section className="mt-10">
            <div className="h-8 w-44 rounded-2xl bg-white" />
            <div className="mt-3 overflow-hidden rounded-[32px] bg-white shadow-[0_12px_40px_rgba(15,23,42,0.05)]">
              <div className="h-24 bg-white" />
              <div className="mx-5 h-px bg-[#E5E5EA]" />
              <div className="h-24 bg-white" />
            </div>
          </section>

          <div className="mt-8 h-16 rounded-[24px] bg-white" />
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#FAF7F4] px-5 pb-28 pt-[max(60px,env(safe-area-inset-top))] text-[#1C0617]">
      <div className="mx-auto w-full max-w-[390px]">
        <section className="flex items-center justify-between">
  <button
    type="button"
    onClick={() => router.push('/me')}
    className="flex h-11 w-11 items-center justify-center rounded-full border border-black/5 bg-white"
  >
    <span className="text-[28px] leading-none">‹</span>
  </button>

  <h1 className="text-[28px] font-black tracking-[-0.05em]">
    Edit Profile
  </h1>

  <div className="w-11" />
</section>

        <section className="mt-8 flex flex-col items-center text-center">
          <div className="relative">
            <div className="h-32 w-32 overflow-hidden rounded-full bg-[#F2EEE9] ring-4 ring-[#FAF7F4]">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt={name || 'Profile'}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-5xl font-black text-slate-400">
                  {(name || 'C').slice(0, 1).toUpperCase()}
                </div>
              )}
            </div>

            <label className="absolute bottom-0 right-0 flex h-11 w-11 items-center justify-center rounded-full border border-black/5 bg-[#F0B1DE]">
              <AppIcon name="pen" size={18} className="opacity-100" />

              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  handleSelectAvatar(e.target.files?.[0] || null)
                  e.currentTarget.value = ''
                }}
                className="hidden"
                disabled={loading}
              />
            </label>
          </div>

          <h2 className="mt-6 max-w-full truncate text-[24px] sm:text-[32px] font-black leading-none tracking-[-0.06em]">
            {name || 'User Name'}
          </h2>

          <p className="mt-3 max-w-full truncate text-[14px] sm:text-[19px] font-medium text-[#8E8E93]">
            {email}
          </p>
        </section>

        <section className="mt-7">
          <h2 className="mb-3 px-2 text-[22px] sm:text-[28px] font-black tracking-[-0.05em]">
            Account Info
          </h2>

          <div className="overflow-hidden rounded-[24px] sm:rounded-[32px] bg-white border border-black/5">
            <div className="px-4 py-2.5">
              <label className="block text-[13px] font-semibold text-[#8E8E93]">
                Name
              </label>

              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setMessage('')
                }}
                placeholder="Your name"
                className="mt-1 h-9 w-full appearance-none bg-transparent text-[15px] font-semibold text-black outline-none"
                disabled={loading}
              />
            </div>

            <div className="mx-5 h-px bg-[#ECECEC]" />

            <div className="px-4 py-2.5">
              <label className="block text-[13px] font-semibold text-[#8E8E93]">
                Email
              </label>

              <input
                type="email"
                value={email}
                readOnly
                className="mt-1 h-9 w-full appearance-none bg-transparent text-[15px] font-semibold text-black outline-none"
              />
            </div>

            <div className="mx-5 h-px bg-[#ECECEC]" />

            <div className="px-5 py-2.5">
              <label className="block text-[13px] font-semibold text-[#8E8E93]">
                Region
              </label>

              <select
                value={region}
                onChange={(e) => {
                  setRegion(e.target.value)
                  setProvince('')
                  setMessage('')
                }}
                disabled={loading}
                className="mt-1 h-9 w-full appearance-none bg-transparent text-[15px] font-semibold text-black outline-none"
              >
                <option value="">Select region</option>
                {REGIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            <div className="mx-5 h-px bg-[#ECECEC]" />

            <div className="px-5 py-5">
              <label className="block text-[13px] font-semibold text-[#8E8E93]">
                Province
              </label>

              <select
                value={province}
                onChange={(e) => {
                  setProvince(e.target.value)
                  setMessage('')
                }}
                disabled={loading || !region}
                className="mt-2 h-8 w-full appearance-none bg-transparent text-[14px] font-semibold text-black outline-none disabled:text-[#8E8E93]"
              >
                <option value="">
                  {region ? 'Select province' : 'Select region first'}
                </option>
                {provinceOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {message ? (
          <div className="mt-5 rounded-[24px] border border-red-100 bg-[#FFF1F1] px-5 py-4 text-sm font-bold text-red-500">
            {message}
          </div>
        ) : null}

        <section className="mt-8">
          <button
            type="button"
            onClick={handleSave}
            disabled={loading}
            className="flex h-12 w-full items-center justify-center rounded-[18px] bg-[#F0B1DE] text-[15px] font-bold text-[#1C0617] transition active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? 'Saving...' : 'Save Changes'}
          </button>
        </section>

        <section className="mt-8">
          <div className="overflow-hidden rounded-[20px] bg-white border border-black/5">
            <div className="flex items-start gap-4 px-5 py-5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[#F2F3F7]">
                <AppIcon name="bell-notification-social-media" size={24} />
              </div>

              <div>
                <p className="text-[16px] font-bold tracking-[-0.03em]">
                  Profile sync
                </p>

                <p className="mt-1 text-[13px] font-medium leading-relaxed text-[#8E8E93]">
                  Your name, avatar, region, and province will refresh across
                  the app after saving.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
    )
}