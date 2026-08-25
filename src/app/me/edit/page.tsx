'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import NextImage from 'next/image'
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

const allowedAvatarTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
]

if (!allowedAvatarTypes.includes(file.type.toLowerCase())) {
  setAvatarFile(null)
  setMessage('Please choose a JPEG, PNG or WEBP image')
  return
}

if (file.size <= 0) {
  setAvatarFile(null)
  setMessage('The selected image is empty')
  return
}

if (file.size > 5 * 1024 * 1024) {
  setAvatarFile(null)
  setMessage('Image must be 5MB or smaller')
  return
}

  if (previewUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(previewUrl)
  }

  setAvatarFile(file)
  setPreviewUrl(URL.createObjectURL(file))
}

async function resizeAvatar(
  file: File
): Promise<Blob> {
  const image = new Image()
  const objectUrl = URL.createObjectURL(file)

  try {
    await new Promise<void>(
      (resolve, reject) => {
        image.onload = () => resolve()

        image.onerror = () => {
          reject(
            new Error(
              'The selected image could not be opened'
            )
          )
        }

        image.src = objectUrl
      }
    )

    if (
      !Number.isFinite(image.width) ||
      !Number.isFinite(image.height) ||
      image.width <= 0 ||
      image.height <= 0
    ) {
      throw new Error(
        'The selected image has invalid dimensions'
      )
    }

    const size = 800
    const canvas =
      document.createElement('canvas')

    canvas.width = size
    canvas.height = size

    const ctx = canvas.getContext('2d')

    if (!ctx) {
      throw new Error('Cannot resize image')
    }

    const scale = Math.max(
      size / image.width,
      size / image.height
    )

    const width = image.width * scale
    const height = image.height * scale
    const x = (size - width) / 2
    const y = (size - height) / 2

    ctx.drawImage(
      image,
      x,
      y,
      width,
      height
    )

    return await new Promise<Blob>(
      (resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(
                new Error(
                  'Cannot convert image'
                )
              )

              return
            }

            resolve(blob)
          },
          'image/webp',
          0.82
        )
      }
    )
  } finally {
    image.onload = null
    image.onerror = null
    image.src = ''

    URL.revokeObjectURL(objectUrl)
  }
}

async function uploadAvatar() {
  if (!avatarFile) {
    return avatarUrl
  }

  const resizedBlob =
    await resizeAvatar(avatarFile)

  if (
    resizedBlob.size <= 0 ||
    resizedBlob.size > 5 * 1024 * 1024
  ) {
    throw new Error(
      'Processed avatar is invalid or too large'
    )
  }

  const formData = new FormData()

  formData.append(
    'file',
    resizedBlob,
    `avatar-${Date.now()}.webp`
  )

  const response = await fetch(
    '/api/profile/avatar',
    {
      method: 'POST',
      body: formData,
      cache: 'no-store',
    }
  )

  const result = (await response
    .json()
    .catch(() => null)) as {
    avatarUrl?: unknown
    error?: unknown
  } | null

  if (!response.ok) {
    const errorMessage =
      typeof result?.error === 'string'
        ? result.error
        : 'Unable to upload avatar'

    throw new Error(errorMessage)
  }

  const uploadedAvatarUrl =
    typeof result?.avatarUrl === 'string'
      ? result.avatarUrl.trim()
      : ''

  if (!uploadedAvatarUrl) {
    throw new Error(
      'Avatar upload returned an invalid URL'
    )
  }

  return uploadedAvatarUrl
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

      const nextAvatarUrl = await uploadAvatar()
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
     <main className="min-h-screen bg-ground px-5 pt-[max(60px,env(safe-area-inset-top))] pb-[max(40px,env(safe-area-inset-bottom))] text-ink">
       <div className="ciiya-safe-container">
          <div className="flex items-center justify-between px-2">
            <div className="h-14 w-14 rounded-full bg-surface shadow-[0_12px_35px_rgba(15,23,42,0.06)]" />
            <div className="h-6 w-32 rounded-full bg-surface" />
            <div className="h-14 w-14" />
          </div>

          <section className="mt-10 flex flex-col items-center">
            <div className="h-36 w-36 rounded-full bg-surface shadow-[0_16px_45px_rgba(15,23,42,0.06)]" />
            <div className="mt-6 h-10 w-52 rounded-full bg-surface" />
            <div className="mt-3 h-6 w-64 rounded-full bg-surface" />
            <div className="mt-5 h-12 w-36 rounded-full bg-surface" />
          </section>

          <section className="mt-10">
            <div className="h-8 w-44 rounded-2xl bg-surface" />
            <div className="mt-3 overflow-hidden rounded-hero bg-surface shadow-[0_12px_40px_rgba(15,23,42,0.05)]">
              <div className="h-24 bg-surface" />
              <div className="mx-5 h-px bg-ground-sunken" />
              <div className="h-24 bg-surface" />
            </div>
          </section>

          <div className="mt-8 h-16 rounded-panel bg-surface" />
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-ground px-5 pb-28 pt-[max(32px,env(safe-area-inset-top))] text-ink sm:px-8 lg:px-12">
      <div className="mx-auto w-full max-w-3xl">
        <section className="flex items-center justify-between">
  <button
    type="button"
    onClick={() => router.push('/me')}
    className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface"
  >
    <span className="text-[28px] leading-none">‹</span>
  </button>

  <h1 className="text-[28px] font-semibold tracking-[-0.05em]">
    แก้ไขโปรไฟล์
  </h1>

  <div className="w-11" />
</section>

        <section className="mt-8 flex flex-col items-center text-center">
          <div className="relative">
            <div className="relative h-32 w-32 overflow-hidden rounded-full bg-ground-sunken ring-4 ring-ground">
              {previewUrl ? (
                <NextImage
                  src={previewUrl}
                  alt={name || 'Profile'}
                  fill
                  sizes="128px"
                  unoptimized={previewUrl.startsWith('blob:')}
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-5xl font-semibold text-muted">
                  {(name || 'C').slice(0, 1).toUpperCase()}
                </div>
              )}
            </div>

            <label className="absolute bottom-0 right-0 flex h-11 w-11 items-center justify-center rounded-full border border-line bg-ink text-white">
              <AppIcon name="pen" size={18} className="opacity-100" />

              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  handleSelectAvatar(e.target.files?.[0] || null)
                  e.currentTarget.value = ''
                }}
                className="hidden"
                disabled={loading}
              />
            </label>
          </div>

          <h2 className="mt-6 max-w-full truncate text-[24px] sm:text-[32px] font-semibold leading-none tracking-[-0.06em]">
            {name || 'ผู้ใช้งาน Ciiya'}
          </h2>

          <p className="mt-3 max-w-full truncate text-[14px] sm:text-[19px] font-medium text-muted">
            {email}
          </p>
        </section>

        <section className="mt-7">
          <h2 className="mb-3 px-2 text-[22px] sm:text-[28px] font-semibold tracking-[-0.05em]">
            ข้อมูลบัญชี
          </h2>

          <div className="overflow-hidden rounded-panel sm:rounded-hero bg-surface border border-line">
            <div className="px-4 py-2.5">
              <label className="block text-[13px] font-semibold text-muted">
                ชื่อ
              </label>

              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setMessage('')
                }}
                placeholder="ชื่อของคุณ"
                className="mt-1 h-9 w-full appearance-none bg-transparent text-[15px] font-semibold text-ink outline-none"
                disabled={loading}
              />
            </div>

            <div className="mx-5 h-px bg-ground-sunken" />

            <div className="px-4 py-2.5">
              <label className="block text-[13px] font-semibold text-muted">
                อีเมล
              </label>

              <input
                type="email"
                value={email}
                readOnly
                className="mt-1 h-9 w-full appearance-none bg-transparent text-[15px] font-semibold text-ink outline-none"
              />
            </div>

            <div className="mx-5 h-px bg-ground-sunken" />

            <div className="px-5 py-2.5">
              <label className="block text-[13px] font-semibold text-muted">
                ภูมิภาค
              </label>

              <select
                value={region}
                onChange={(e) => {
                  setRegion(e.target.value)
                  setProvince('')
                  setMessage('')
                }}
                disabled={loading}
                className="mt-1 h-9 w-full appearance-none bg-transparent text-[15px] font-semibold text-ink outline-none"
              >
                <option value="">เลือกภูมิภาค</option>
                {REGIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            <div className="mx-5 h-px bg-ground-sunken" />

            <div className="px-5 py-5">
              <label className="block text-[13px] font-semibold text-muted">
                จังหวัด
              </label>

              <select
                value={province}
                onChange={(e) => {
                  setProvince(e.target.value)
                  setMessage('')
                }}
                disabled={loading || !region}
                className="mt-2 h-8 w-full appearance-none bg-transparent text-[14px] font-semibold text-ink outline-none disabled:text-muted"
              >
                <option value="">
                  {region ? 'เลือกจังหวัด' : 'เลือกภูมิภาคก่อน'}
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
          <div className="mt-5 rounded-panel border border-red-100 bg-red-50 px-5 py-4 text-sm font-bold text-red-500">
            {message}
          </div>
        ) : null}

        <section className="mt-8">
          <button
            type="button"
            onClick={handleSave}
            disabled={loading}
            className="flex h-12 w-full items-center justify-center rounded-control bg-ink text-[15px] font-medium text-white transition active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? 'กำลังบันทึก…' : 'บันทึกการเปลี่ยนแปลง'}
          </button>
        </section>

        <section className="mt-8">
          <div className="overflow-hidden rounded-panel bg-surface border border-line">
            <div className="flex items-start gap-4 px-5 py-5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-ground-sunken">
                <AppIcon name="bell" size={24} />
              </div>

              <div>
                <p className="text-[16px] font-bold tracking-[-0.03em]">
                  ซิงค์ข้อมูลโปรไฟล์
                </p>

                <p className="mt-1 text-[13px] font-medium leading-relaxed text-muted">
                  ชื่อ รูปโปรไฟล์ ภูมิภาค และจังหวัดจะอัปเดตทั่วทั้งแอปหลังบันทึก
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
    )
}
