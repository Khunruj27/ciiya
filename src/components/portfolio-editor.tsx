'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { createClient } from '@/lib/supabase-client'
import { refreshPortfolioCache } from '@/app/portfolio/actions'
import { resizeImageToJpeg } from '@/lib/resize-image'
import type { Portfolio } from '@/lib/portfolio-types'
import {
  getPortfolioTemplate,
  PORTFOLIO_TEMPLATES,
} from '@/lib/portfolio-templates'
import PortfolioTemplateHero from '@/components/portfolio-template-hero'

type Props = {
  initial: Portfolio
  userId: string
  origin: string
}

const STORAGE_BUCKET = 'albums'
const MAX_GALLERY = 24
const MAX_SOURCE_FILE_BYTES = 30 * 1024 * 1024

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/

const ACCENTS: { key: Portfolio['accent']; label: string; swatch: string }[] = [
  { key: 'gold', label: 'Champagne Gold', swatch: 'var(--ciiya-gold)' },
  { key: 'ink', label: 'Sleek Black', swatch: 'var(--ciiya-ink)' },
  { key: 'rose', label: 'Rosewood', swatch: 'var(--ciiya-rose)' },
]

const TEMPLATE_GROUPS = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'wedding', label: 'งานแต่งงาน' },
  { key: 'studio', label: 'สตูดิโอ' },
  { key: 'story', label: 'เล่าเรื่อง' },
  { key: 'modern', label: 'โมเดิร์น' },
] as const

type TemplateGroup = (typeof TEMPLATE_GROUPS)[number]['key']

const GALLERY_LAYOUTS: {
  key: Portfolio['gallery_layout']
  label: string
  hint: string
}[] = [
  { key: 'carousel', label: 'Seamless Swipe', hint: 'ภาพขนาดใหญ่ไหลต่อกันเมื่อปัด เหมือนงาน Carousel' },
  { key: 'grid', label: 'Clean Grid', hint: 'กริดสองคอลัมน์เรียบสะอาด เห็นภาพได้รวดเร็ว' },
  { key: 'masonry', label: 'Photo Dump', hint: 'จังหวะภาพสูงต่ำแบบอิสระ ดูเป็นธรรมชาติ' },
  { key: 'filmstrip', label: 'Film Roll', hint: 'ภาพแนวนอนต่อเนื่องในบรรยากาศฟิล์ม' },
  { key: 'collage', label: 'Hero Canvas', hint: 'ภาพหลักหนึ่งภาพและรายละเอียดประกอบสองภาพ' },
  { key: 'collage_story', label: 'Story Flow', hint: 'เล่าเรื่องเป็นช่วงด้วยภาพใหญ่สลับภาพเล็ก' },
  { key: 'collage_panorama', label: 'Panorama Flow', hint: 'เปิดด้วยภาพกว้าง แล้วไหลต่อสู่รายละเอียด' },
  { key: 'collage_tiles', label: 'Freeform Canvas', hint: 'คอลลาจหลายขนาดแบบ Editorial ที่มีอิสระ' },
  { key: 'collage_overlap', label: 'Layered Cards', hint: 'ภาพซ้อนเหลื่อมกันเหมือนการ์ดบน Canvas' },
  { key: 'collage_frames', label: 'Print Journal', hint: 'ภาพพิมพ์สลับซ้ายขวาบนพื้นที่แบบสมุดภาพ' },
]

export default function PortfolioEditor({
  initial,
  userId,
  origin,
}: Props) {
  const supabase = useMemo(() => createClient(), [])

  const [form, setForm] = useState<Portfolio>(initial)
  const [saved, setSaved] = useState<Portfolio>(initial)
  const [status, setStatus] = useState<'idle' | 'saving' | 'done'>('idle')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [uploading, setUploading] = useState<'hero' | 'gallery' | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadLabel, setUploadLabel] = useState('')
  const [templateGroup, setTemplateGroup] = useState<TemplateGroup>('all')

  const heroInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const gallerySensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(saved),
    [form, saved]
  )

  useEffect(() => {
    if (!dirty) return
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warnBeforeLeaving)
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving)
  }, [dirty])

  const slugValid = SLUG_PATTERN.test(form.slug)
  const publicUrl = `${origin || 'https://ciiya.app'}/portfolio/${saved.slug}`
  const viewUrl = `/portfolio/${saved.slug}`
  const publishChecks = {
    name: Boolean(saved.display_name?.trim()),
    image: Boolean(saved.hero_photo_url || saved.gallery_urls.length > 0),
    contact: Boolean(
      (saved.contact_line?.trim() && saved.show_contact_line !== false) ||
      (saved.contact_phone?.trim() && saved.show_contact_phone !== false) ||
      (saved.contact_facebook?.trim() && saved.show_contact_facebook !== false) ||
      (saved.contact_instagram?.trim() && saved.show_contact_instagram !== false) ||
      (saved.contact_tiktok?.trim() && saved.show_contact_tiktok !== false) ||
      (saved.contact_email?.trim() && saved.show_contact_email !== false) ||
      (saved.contact_website?.trim() && saved.show_contact_website !== false)
    ),
  }
  const readyToPublish = Object.values(publishChecks).every(Boolean)

  function set<K extends keyof Portfolio>(key: K, value: Portfolio[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setStatus('idle')
    setError('')
  }

  /*
   * Uploads go straight from the browser to storage. The bucket's policy
   * only lets an authenticated user write under a folder named by their own
   * id, so the path leads with userId; anything else is rejected server-side
   * no matter what the client sends.
   */
  async function uploadImage(
    file: File,
    onProgress: (value: number) => void
  ): Promise<string> {
    if (!file.type.startsWith('image/')) throw new Error('unsupported image')
    if (file.size > MAX_SOURCE_FILE_BYTES) throw new Error('image too large')

    onProgress(8)
    const blob = await resizeImageToJpeg(file)
    onProgress(35)
    const path = `${userId}/portfolio/${crypto.randomUUID()}.jpg`

    onProgress(48)
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(path, blob, { contentType: 'image/jpeg', upsert: false })

    if (uploadError) throw uploadError
    onProgress(100)

    return supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path).data
      .publicUrl
  }

  async function handleHeroFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (!file.type.startsWith('image/') || file.size > MAX_SOURCE_FILE_BYTES) {
      setError('Supports image files up to 30 MB')
      return
    }

    setUploading('hero')
    setUploadProgress(0)
    setUploadLabel('Preparing cover image')
    setError('')
    try {
      const url = await uploadImage(file, (value) => {
        setUploadProgress(value)
        setUploadLabel(value < 40 ? 'Resizing image' : value < 100 ? 'Uploading cover image' : 'Cover image uploaded')
      })
      set('hero_photo_url', url)
    } catch {
      setError('Upload failed. Try again')
    } finally {
      setUploading(null)
      setTimeout(() => {
        setUploadProgress(0)
        setUploadLabel('')
      }, 1000)
    }
  }

  async function handleGalleryFiles(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return

    if (
      files.some(
        (file) =>
          !file.type.startsWith('image/') || file.size > MAX_SOURCE_FILE_BYTES
      )
    ) {
      setError('Some files aren’t images or exceed 30 MB')
      return
    }

    const room = MAX_GALLERY - form.gallery_urls.length
    if (room <= 0) {
      setError(`You can add up to ${MAX_GALLERY} photos`)
      return
    }

    setUploading('gallery')
    setUploadProgress(0)
    setUploadLabel('Preparing photos')
    setError('')
    const uploaded: string[] = []
    try {
      const selectedFiles = files.slice(0, room)
      for (const [index, file] of selectedFiles.entries()) {
        uploaded.push(
          await uploadImage(file, (fileProgress) => {
            const total = Math.round(
              ((index + fileProgress / 100) / selectedFiles.length) * 100
            )
            setUploadProgress(total)
            setUploadLabel(
              total < 100
                ? `Uploading photo ${index + 1} of ${selectedFiles.length}`
                : `Upload complete ${selectedFiles.length} photos`
            )
          })
        )
      }
      setForm((current) => ({
        ...current,
        gallery_urls: [...current.gallery_urls, ...uploaded].slice(0, MAX_GALLERY),
      }))
      setStatus('idle')
    } catch {
      if (uploaded.length > 0) {
        setForm((current) => ({
          ...current,
          gallery_urls: [...current.gallery_urls, ...uploaded].slice(0, MAX_GALLERY),
        }))
        setStatus('idle')
      }
      setError(
        uploaded.length > 0
          ? `Upload complete ${uploaded.length} photos. The rest failed`
          : 'Upload failed. Try again'
      )
    } finally {
      setUploading(null)
      setTimeout(() => {
        setUploadProgress(0)
        setUploadLabel('')
      }, 1000)
    }
  }

  function removeGalleryImage(url: string) {
    setForm((current) => ({
      ...current,
      gallery_urls: current.gallery_urls.filter((item) => item !== url),
      hero_photo_url:
        current.hero_photo_url === url ? null : current.hero_photo_url,
    }))
    setStatus('idle')
    setError('')
  }

  function handleGalleryDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = form.gallery_urls.indexOf(String(active.id))
    const newIndex = form.gallery_urls.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return

    set('gallery_urls', arrayMove(form.gallery_urls, oldIndex, newIndex))
  }

  async function removeOwnedPortfolioFiles(urls: string[]) {
    const marker = `/storage/v1/object/public/${STORAGE_BUCKET}/`
    const paths = urls
      .map((url) => {
        try {
          const pathname = new URL(url).pathname
          const index = pathname.indexOf(marker)
          if (index < 0) return null
          return decodeURIComponent(pathname.slice(index + marker.length))
        } catch {
          return null
        }
      })
      .filter(
        (path): path is string =>
          path !== null && path.startsWith(`${userId}/portfolio/`)
      )

    if (paths.length > 0) {
      await supabase.storage.from(STORAGE_BUCKET).remove(paths)
    }
  }

  /*
   * The public page is cached, so every write is followed by a ping that
   * drops the cached copy. If that ping fails the save still stands — the
   * page just catches up on its own within the minute.
   */
  async function persist(patch: Partial<Portfolio>) {
    const { data, error: writeError } = await supabase
      .from('portfolios')
      .update(patch)
      .eq('user_id', initial.user_id)
      .select('*')
      .single()

    if (writeError) throw writeError

    await refreshPortfolioCache().catch(() => {})

    return data as Portfolio
  }

  async function handleSave() {
    if (!slugValid) {
      setError('The link must be a-z, 0-9 or - Length 3–40 characters')
      return
    }

    setStatus('saving')
    setError('')

    try {
      const next = await persist({
        slug: form.slug,
        display_name: form.display_name || null,
        tagline: form.tagline || null,
        bio: form.bio || null,
        location: form.location || null,
        hero_photo_url: form.hero_photo_url || null,
        gallery_urls: form.gallery_urls,
        gallery_layout: form.gallery_layout || 'carousel',
        contact_line: form.contact_line || null,
        contact_phone: form.contact_phone || null,
        contact_email: form.contact_email || null,
        contact_instagram: form.contact_instagram || null,
        contact_facebook: form.contact_facebook || null,
        contact_tiktok: form.contact_tiktok || null,
        contact_website: form.contact_website || null,
        show_contact_line: form.show_contact_line !== false,
        show_contact_phone: form.show_contact_phone !== false,
        show_contact_email: form.show_contact_email !== false,
        show_contact_instagram: form.show_contact_instagram !== false,
        show_contact_facebook: form.show_contact_facebook !== false,
        show_contact_tiktok: form.show_contact_tiktok !== false,
        show_contact_website: form.show_contact_website !== false,
        accent: form.accent,
        layout: form.layout,
      })

      // A photo may be both the cover and a gallery item. Delete the storage
      // object only when the saved Portfolio no longer references it anywhere.
      const stillReferenced = new Set(
        [next.hero_photo_url, ...next.gallery_urls].filter(Boolean)
      )
      const previouslyReferenced = [
        saved.hero_photo_url,
        ...saved.gallery_urls,
      ].filter(Boolean) as string[]
      const filesNoLongerUsed = [...new Set(previouslyReferenced)].filter(
        (url) => !stillReferenced.has(url)
      )
      await removeOwnedPortfolioFiles(filesNoLongerUsed).catch(() => {})

      setSaved(next)
      setForm(next)
      setStatus('done')
    } catch (caught) {
      const code = (caught as { code?: string })?.code
      setStatus('idle')
      setError(
        code === '23505'
          ? 'This link is already taken. Try a different name'
          : code === '23514'
            ? 'The selected style isn’t ready in the database yet. Please run the latest migration and try again'
          : 'Save failed. Try again'
      )
    }
  }

  async function handlePublishToggle() {
    const next = !saved.is_published

    if (next && dirty) {
      setError('Save your changes before publishing')
      return
    }

    if (next && !readyToPublish) {
      setError('Add a name, photos, and contact channels before publishing')
      return
    }

    setStatus('saving')
    setError('')

    try {
      const updated = await persist({ is_published: next })
      setSaved(updated)
      setForm((current) => ({ ...current, is_published: updated.is_published }))
      setStatus('idle')
    } catch {
      setStatus('idle')
      setError('Couldn’t change the status. Try again')
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('Couldn’t copy')
    }
  }

  async function handleShare() {
    try {
      if (navigator.share) {
        await navigator.share({
          title: saved.display_name || 'Portfolio',
          text: saved.tagline || 'View my portfolio',
          url: publicUrl,
        })
        return
      }
      await handleCopy()
    } catch (caught) {
      if ((caught as { name?: string })?.name !== 'AbortError') {
        setError('Couldn’t share the link')
      }
    }
  }

  return (
    <div className="mt-6 space-y-3">
      {/* ── STATUS ────────────────────────────────────────────────────
          Published or not, and the link itself. This is what the owner
          comes to this screen for, so it sits above the form. */}
      <section
        className={`rounded-hero p-5 ${
          saved.is_published
            ? 'bg-ink text-white'
            : 'border border-line bg-surface'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              saved.is_published ? 'bg-gold' : 'bg-line-strong'
            }`}
          />
          <p
            className={`text-[11px] font-medium uppercase tracking-[0.18em] ${
              saved.is_published ? 'text-white/50' : 'text-muted'
            }`}
          >
            {saved.is_published ? 'Published' : 'Not published'}
          </p>
        </div>

        <p
          className={`mt-3 break-all text-[15px] font-semibold tracking-[-0.01em] ${
            saved.is_published ? 'text-white' : 'text-ink'
          }`}
        >
          {publicUrl.replace(/^https?:\/\//, '')}
        </p>

        <p
          className={`mt-1.5 text-[12px] font-normal leading-relaxed ${
            saved.is_published ? 'text-white/50' : 'text-muted'
          }`}
        >
          {saved.is_published
            ? 'This link is ready to send to clients'
            : 'Save, then view your Portfolio right away, and publish when ready'}
        </p>

        {!saved.is_published ? (
          <div className="mt-4 grid grid-cols-3 gap-2" aria-label="Readiness before publishing">
            {[
              ['Name', publishChecks.name],
              ['Photos', publishChecks.image],
              ['Contact channels', publishChecks.contact],
            ].map(([label, complete]) => (
              <div key={String(label)} className={`rounded-control border px-2 py-2 text-center text-[10px] font-medium ${complete ? 'border-gold/35 bg-gold-soft text-gold-deep' : 'border-line bg-ground-sunken text-muted'}`}>
                <span className="mr-1" aria-hidden>{complete ? '✓' : '○'}</span>
                {String(label)}
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          {dirty ? (
            <span className={`inline-flex h-11 items-center rounded-full px-5 text-[13px] font-semibold opacity-50 ${saved.is_published ? 'bg-gold text-ink' : 'bg-ink text-white'}`}>
              Save before previewing
            </span>
          ) : (
            <a
              href={viewUrl}
              target="_blank"
              rel="noreferrer"
              className={`inline-flex h-11 items-center rounded-full px-5 text-[13px] font-semibold transition active:scale-[0.97] ${saved.is_published ? 'bg-gold text-ink' : 'bg-ink text-white'}`}
            >
              View Portfolio
            </a>
          )}

          <button
            type="button"
            onClick={handlePublishToggle}
            disabled={status === 'saving'}
            className={`inline-flex h-11 items-center rounded-full px-5 text-[13px] font-semibold transition active:scale-[0.97] disabled:opacity-50 ${
              saved.is_published
                ? 'border border-white/20 text-white'
                : 'border border-line text-muted'
            }`}
          >
            {saved.is_published ? 'Unpublish' : 'Publish portfolio'}
          </button>

          {saved.is_published ? (
            <>
              <button type="button" onClick={handleShare} className="inline-flex h-11 items-center rounded-full border border-white/20 px-5 text-[13px] font-semibold text-white transition active:scale-[0.97]">
                Share Portfolio
              </button>
              <button type="button" onClick={handleCopy} className="inline-flex h-11 items-center rounded-full border border-white/20 px-5 text-[13px] font-semibold text-white transition active:scale-[0.97]">
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </>
          ) : null}
        </div>

      </section>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_420px] xl:grid-cols-[minmax(0,1fr)_500px]">
        <div className="min-w-0 space-y-3">

      {/* ── IDENTITY ─────────────────────────────────────────────── */}
      <div className={'space-y-3'}>
      <Card id="portfolio-identity" title="Identity" hint="The name and opening line clients see first">
        <Field label="Portfolio link">
          <div className="flex items-center rounded-control border border-line bg-ground-sunken px-3">
            <span className="shrink-0 text-[13px] font-normal text-muted">
              /portfolio/
            </span>
            <input
              value={form.slug}
              onChange={(event) =>
                set(
                  'slug',
                  event.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9-]/g, '-')
                    .slice(0, 40)
                )
              }
              className="h-12 w-full bg-transparent text-[15px] font-semibold text-ink outline-none"
              placeholder="ciiya-studio"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          {form.slug && !slugValid ? (
            <p className="mt-1.5 text-[12px] font-normal text-rose">
              Use a-z, 0-9 and - Length 3–40 characters
            </p>
          ) : null}
        </Field>

        <Field label="Display name">
          <Input
            value={form.display_name || ''}
            onChange={(value) => set('display_name', value)}
            placeholder="e.g. Ciiya Studio"
            maxLength={60}
          />
        </Field>

        <Field label="Intro line">
          <Input
            value={form.tagline || ''}
            onChange={(value) => set('tagline', value)}
            placeholder="Wedding photographer telling stories with natural light"
            maxLength={120}
          />
        </Field>

        <Field label="Service area">
          <Input
            value={form.location || ''}
            onChange={(value) => set('location', value)}
            placeholder="Chiang Mai · Nationwide"
            maxLength={60}
          />
        </Field>
      </Card>

      {/* ── HERO ─────────────────────────────────────────────────────
          Upload a cover of your own, or pick one from an album. Either
          way the page opens on a real photograph, not a placeholder. */}
      </div>
      <div className={'space-y-3'}>
      <Card
        id="portfolio-images"
        title="Cover image"
        hint="The main image clients see first. Upload only the photos you want to use on your portfolio"
      >
        <input
          ref={heroInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleHeroFile}
        />

        <div className="flex items-stretch gap-3">
          <div className="relative aspect-[3/4] w-24 shrink-0 overflow-hidden rounded-card bg-ground-sunken">
            {form.hero_photo_url ? (
              <Image
                src={form.hero_photo_url}
                alt="Cover image"
                fill
                unoptimized
                sizes="96px"
                className="object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center px-2 text-center text-[10px] font-medium leading-tight text-muted">
                Automatic
              </div>
            )}
          </div>

          <div className="flex flex-1 flex-col justify-center gap-2">
            <button
              type="button"
              onClick={() => heroInputRef.current?.click()}
              disabled={uploading === 'hero'}
              className="inline-flex h-11 items-center justify-center rounded-full bg-ink px-4 text-[13px] font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
            >
              {uploading === 'hero' ? 'Uploading…' : 'Upload your own'}
            </button>

            {form.hero_photo_url ? (
              <button
                type="button"
                onClick={() => set('hero_photo_url', null)}
                className="inline-flex h-11 items-center justify-center rounded-full border border-line px-4 text-[13px] font-semibold text-muted transition active:scale-[0.98]"
              >
                Use automatic
              </button>
            ) : null}
          </div>
        </div>

        {uploading === 'hero' || (uploadLabel.includes('Cover') && uploadProgress > 0) ? (
          <UploadProgress value={uploadProgress} label={uploadLabel} />
        ) : null}

        {form.gallery_urls.length > 0 ? (
          <div>
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
              Or choose a cover from the gallery
            </p>
            <div className="pf-gallery-scroll flex gap-2 overflow-x-auto pb-1">
              {form.gallery_urls.map((url, index) => {
                const selected = form.hero_photo_url === url
                return (
                  <button
                    key={url}
                    type="button"
                    onClick={() => set('hero_photo_url', url)}
                    aria-label={`Use photo ${index + 1} as the cover`}
                    aria-pressed={selected}
                    className={`relative aspect-[4/3] w-20 shrink-0 overflow-hidden rounded-control border-2 transition active:scale-95 ${selected ? 'border-gold shadow-card' : 'border-transparent'}`}
                  >
                    <Image src={url} alt="" fill unoptimized sizes="80px" className="object-cover" />
                    {selected ? <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-gold text-[10px] font-bold text-ink">✓</span> : null}
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}

      </Card>

      {/* ── GALLERY ──────────────────────────────────────────────────
          The owner's own images, uploaded straight here. When there are
          any, they become the photographs the public page shows — no
          album required. */}
      <Card
        title="Photo gallery"
        hint="Upload, reorder, and choose the layout clients will actually see"
      >
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleGalleryFiles}
        />

        {/* The DndContext carries a stable id. Without it dnd-kit falls back to
            an incrementing counter for its generated aria-describedby, which
            diverges between the server and client renders and throws a
            hydration mismatch. */}
        {form.gallery_urls.length > 0 ? (
          <DndContext
            id="portfolio-gallery-dnd"
            sensors={gallerySensors}
            collisionDetection={closestCenter}
            onDragEnd={handleGalleryDragEnd}
          >
            <SortableContext
              items={form.gallery_urls}
              strategy={rectSortingStrategy}
            >
              <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {form.gallery_urls.map((url, index) => (
                  <SortableGalleryImage
                    key={url}
                    url={url}
                    index={index}
                    onRemove={() => removeGalleryImage(url)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : null}

        {form.gallery_urls.length > 1 ? (
          <p className="rounded-control bg-gold-soft px-3 py-2.5 text-[11px] leading-relaxed text-gold-deep">
            Press and hold the handle, then drag to reorder photos on the public page
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => galleryInputRef.current?.click()}
          disabled={uploading === 'gallery' || form.gallery_urls.length >= MAX_GALLERY}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-control border border-dashed border-line-strong bg-ground-sunken text-[13px] font-semibold text-ink transition active:scale-[0.99] disabled:opacity-50"
        >
          {uploading === 'gallery' ? (
            'Uploading…'
          ) : (
            <>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
                className="h-4 w-4"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add photos
            </>
          )}
        </button>

        {uploading === 'gallery' || (uploadLabel.includes('photos') && uploadProgress > 0) ? (
          <UploadProgress value={uploadProgress} label={uploadLabel} />
        ) : null}

        <p className="mt-2 text-right text-[11px] font-normal text-muted tabular-nums">
          {form.gallery_urls.length} / {MAX_GALLERY}
        </p>

        <Field label="รูปแบบแกลเลอรี">
          <p className="mb-3 text-[11px] leading-5 text-muted">เลือกจังหวะการเล่าเรื่องบนมือถือ รูปจริงจะเปลี่ยนในตัวอย่างทันที</p>
          <div className="grid grid-cols-2 gap-2.5">
            {GALLERY_LAYOUTS.map((option) => {
              const active = (form.gallery_layout || 'carousel') === option.key
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => set('gallery_layout', option.key)}
                  className={`overflow-hidden rounded-[18px] border text-left transition active:scale-[0.98] ${active ? 'border-gold bg-gold-soft/35 text-ink shadow-card ring-1 ring-gold/40' : 'border-line bg-surface text-ink'}`}
                >
                  <GalleryLayoutPreview
                    layout={option.key}
                    images={form.gallery_urls}
                    active={active}
                  />
                  <div className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-semibold">{option.label}</p>
                      <span className={`grid h-4.5 w-4.5 place-items-center rounded-full border text-[9px] ${active ? 'border-gold bg-gold text-ink' : 'border-line-strong text-transparent'}`}>✓</span>
                    </div>
                    <p className="mt-1 line-clamp-2 min-h-8 text-[9px] leading-4 text-muted">{option.hint}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </Field>
      </Card>

      {/* ── ABOUT ────────────────────────────────────────────────── */}
      </div>
      <div className={'space-y-3'}>
      <Card id="portfolio-about" title="About you" hint="The paragraph that makes a client reach out">
        <textarea
          value={form.bio || ''}
          onChange={(event) => set('bio', event.target.value.slice(0, 1200))}
          rows={6}
          placeholder="Tell them what you shoot, how you work, and what makes your work different"
          className="w-full resize-y rounded-control border border-line bg-ground-sunken px-3.5 py-3 text-[15px] font-normal leading-[1.7] text-ink outline-none placeholder:text-muted/70 focus:border-line-strong"
        />
        <p className="mt-1.5 text-right text-[11px] font-normal text-muted tabular-nums">
          {(form.bio || '').length} / 1200
        </p>
      </Card>

      {/* ── CONTACT ──────────────────────────────────────────────── */}
      </div>
      <div className={'space-y-3'}>
      <Card
        id="portfolio-contact"
        title="Contact channels"
        hint="Add links or details, then show only the channels you want clients to see"
      >
        <div className="space-y-2.5">
          <ContactChannel
            label="LINE"
            hint="LINE ID or a tap-to-add-friend link"
            value={form.contact_line || ''}
            enabled={form.show_contact_line !== false}
            onChange={(value) => set('contact_line', value)}
            onToggle={() => set('show_contact_line', form.show_contact_line === false)}
            placeholder="@ciiya or https://line.me/ti/p/..."
            inputMode="url"
          />
          <ContactChannel
            label="Phone"
            hint="Tap to call instantly"
            value={form.contact_phone || ''}
            enabled={form.show_contact_phone !== false}
            onChange={(value) => set('contact_phone', value)}
            onToggle={() => set('show_contact_phone', form.show_contact_phone === false)}
            placeholder="08x-xxx-xxxx"
            inputMode="tel"
          />
          <ContactChannel
            label="Facebook"
            hint="Page name or link Facebook"
            value={form.contact_facebook || ''}
            enabled={form.show_contact_facebook !== false}
            onChange={(value) => set('contact_facebook', value)}
            onToggle={() => set('show_contact_facebook', form.show_contact_facebook === false)}
            placeholder="ciiya.studio or https://facebook.com/..."
            inputMode="url"
          />
          <ContactChannel
            label="Instagram"
            hint="Username or profile link"
            value={form.contact_instagram || ''}
            enabled={form.show_contact_instagram !== false}
            onChange={(value) => set('contact_instagram', value)}
            onToggle={() => set('show_contact_instagram', form.show_contact_instagram === false)}
            placeholder="@ciiya.studio or https://instagram.com/..."
            inputMode="url"
          />
          <ContactChannel
            label="TikTok"
            hint="Username or profile link TikTok"
            value={form.contact_tiktok || ''}
            enabled={form.show_contact_tiktok !== false}
            onChange={(value) => set('contact_tiktok', value)}
            onToggle={() => set('show_contact_tiktok', form.show_contact_tiktok === false)}
            placeholder="@ciiya or https://tiktok.com/@..."
            inputMode="url"
          />
          <ContactChannel
            label="Email"
            hint="For sending job details formally"
            value={form.contact_email || ''}
            enabled={form.show_contact_email !== false}
            onChange={(value) => set('contact_email', value)}
            onToggle={() => set('show_contact_email', form.show_contact_email === false)}
            placeholder="hello@ciiya.app"
            inputMode="email"
          />
          <ContactChannel
            label="Website"
            hint="A website or other portfolio link"
            value={form.contact_website || ''}
            enabled={form.show_contact_website !== false}
            onChange={(value) => set('contact_website', value)}
            onToggle={() => set('show_contact_website', form.show_contact_website === false)}
            placeholder="https://ciiya.app"
            inputMode="url"
          />
        </div>

        <p className="rounded-control bg-gold-soft px-3.5 py-3 text-[12px] leading-relaxed text-gold-deep">
          Channels left empty or switched off won’t appear on the page you send to clients
        </p>
      </Card>

      {/* ── STYLE ────────────────────────────────────────────────── */}
      </div>
      <div className={'space-y-3'}>
      <Card
        id="portfolio-design"
        title="เลือกเทมเพลต Portfolio"
        hint="ออกแบบสำหรับหน้าจอมือถือโดยเฉพาะ ทุกแบบใช้ชื่อ สี และรูปจริงของคุณ"
      >
        <div className="rounded-[22px] border border-line bg-ground p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-lg">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-deep">Ciiya Template Collection</p>
              <h3 className="mt-2 text-[20px] font-semibold tracking-[-0.03em] text-ink sm:text-[22px]">เลือกบุคลิกที่ใช่ให้ผลงานของคุณ</h3>
              <p className="mt-1.5 text-[11px] leading-5 text-muted">ทุกการ์ดแสดงสัดส่วนมือถือ 9:16 และเปลี่ยนตัวอย่างจริงทันทีเมื่อเลือก</p>
            </div>
            <div className="flex shrink-0 items-center gap-3 rounded-full border border-gold/45 bg-gold-soft px-4 py-2.5">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-gold text-[10px] font-semibold text-ink">✓</span>
              <div>
                <p className="text-[8px] font-semibold uppercase tracking-[0.14em] text-gold-deep">กำลังใช้งาน</p>
                <p className="text-[12px] font-semibold text-ink">{getPortfolioTemplate(form.layout)?.label}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="กรองเทมเพลต">
          {TEMPLATE_GROUPS.map((group) => (
            <button
              key={group.key}
              type="button"
              onClick={() => setTemplateGroup(group.key)}
              aria-pressed={templateGroup === group.key}
              className={`h-10 shrink-0 rounded-full border px-4 text-[12px] font-semibold transition active:scale-95 ${templateGroup === group.key ? 'border-ink bg-ink text-white' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-ink'}`}
            >
              {group.label}
            </button>
          ))}
        </div>

        <Field label="รูปแบบหน้า">
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {PORTFOLIO_TEMPLATES.filter((layout) => templateGroup === 'all' || layout.group === templateGroup).map((layout) => {
              const active = form.layout === layout.key

              return (
                <button
                  key={layout.key}
                  type="button"
                  onClick={() => set('layout', layout.key)}
                  aria-pressed={active}
                  className={`group relative flex min-h-[230px] overflow-hidden rounded-[20px] border text-left transition duration-300 active:scale-[0.99] ${
                    active
                      ? 'border-gold bg-gold-soft/35 text-ink shadow-card ring-1 ring-gold/40'
                      : 'border-line bg-surface text-ink hover:-translate-y-0.5 hover:border-line-strong hover:shadow-card'
                  }`}
                >
                  <div className="flex w-[38%] max-w-[150px] shrink-0 items-center justify-center border-r border-line bg-ground p-2.5 sm:p-3">
                    <div className="w-full overflow-hidden rounded-[16px] border-[3px] border-ink bg-ground shadow-card">
                      <TemplatePreview template={layout.key} portfolio={form} />
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col justify-center p-3.5 sm:p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                          <span className="rounded-full bg-ground-sunken px-2 py-0.5 text-[8px] font-semibold text-muted">
                            {layout.category}
                          </span>
                          {layout.badge ? <span className="rounded-full bg-gold px-2 py-0.5 text-[8px] font-semibold text-ink">{layout.badge}</span> : null}
                        </div>
                        <p className="truncate text-[14px] font-semibold tracking-[-0.02em] sm:text-[15px]">
                          {layout.label}
                        </p>
                        <p className="mt-1 text-[9px] font-medium text-gold-deep">
                          {layout.mood}
                        </p>
                      </div>
                      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[10px] transition ${active ? 'border-gold bg-gold text-ink' : 'border-line-strong text-transparent group-hover:border-ink group-hover:text-ink'}`}>
                        ✓
                      </span>
                    </div>
                    <p className="mt-3 line-clamp-3 text-[10px] font-normal leading-5 text-muted sm:text-[11px]">
                      {layout.hint}
                    </p>
                    <p className={`mt-4 text-[10px] font-semibold ${active ? 'text-gold-deep' : 'text-muted'}`}>{active ? 'กำลังใช้งาน' : 'แตะเพื่อเลือก'} →</p>
                  </div>
                </button>
              )
            })}
          </div>
        </Field>

        <Field label="สีประจำเทมเพลต">
          <div className="flex flex-wrap gap-2">
            {ACCENTS.map((accent) => (
              <button
                key={accent.key}
                type="button"
                onClick={() => set('accent', accent.key)}
                className={`inline-flex h-11 items-center gap-2.5 rounded-full border px-4 text-[13px] font-semibold transition active:scale-[0.97] ${
                  form.accent === accent.key
                    ? 'border-ink bg-ink text-white'
                    : 'border-line bg-surface text-ink'
                }`}
              >
                <span
                  aria-hidden
                  className="h-3.5 w-3.5 rounded-full"
                  style={{ background: accent.swatch }}
                />
                {accent.label}
              </button>
            ))}
          </div>
        </Field>

      </Card>

      {/* ── SAVE ─────────────────────────────────────────────────────
          Pinned to the bottom of the viewport while there are unsaved
          changes, so a long form never hides its own save button. */}
      </div>
      {error ? (
        <p className="rounded-panel border border-rose/30 bg-surface px-4 py-3 text-[13px] font-medium text-rose">
          {error}
        </p>
      ) : null}

      {dirty ? (
        <div className="pointer-events-none sticky bottom-[max(88px,calc(env(safe-area-inset-bottom)+72px))] z-40 flex justify-end pt-1">
          <button
            type="button"
            onClick={handleSave}
            disabled={status === 'saving'}
            className="pointer-events-auto flex h-13 w-full items-center justify-center rounded-full bg-ink px-8 text-[14px] font-semibold text-white shadow-float transition active:scale-[0.99] disabled:opacity-60 sm:w-auto sm:min-w-[260px]"
          >
            {status === 'saving' ? 'กำลังบันทึก…' : 'บันทึกการแก้ไข'}
          </button>
        </div>
      ) : status === 'done' ? (
        <p className="py-2 text-center text-[13px] font-medium text-gold-deep">
          บันทึกแล้ว
        </p>
      ) : null}
        </div>

        <aside className="order-first min-w-0 lg:order-last lg:sticky lg:top-5">
          <div className="overflow-hidden rounded-hero border border-line bg-surface shadow-lift">
            <div className="flex items-center justify-between border-b border-line px-4 py-3.5 sm:px-5">
              <div>
                <p className="text-[9px] font-medium uppercase tracking-[0.18em] text-gold-deep">ตัวอย่างจริง</p>
                <p className="mt-1 text-[13px] font-semibold text-ink">สิ่งที่ลูกค้าจะเห็น</p>
              </div>
              <span className="rounded-full bg-ink px-3 py-2 text-[9px] font-semibold text-white">มือถือ · 9:16</span>
            </div>

            <div className="bg-ground-sunken p-3 sm:p-4">
              <div data-accent={form.accent} className="mx-auto max-w-[310px] overflow-hidden rounded-[28px] border-[5px] border-ink bg-ground p-1 shadow-card">
                <div className="overflow-hidden rounded-[20px]">
                  <TemplatePreview template={form.layout} portfolio={form} featured />
                </div>
              </div>
            </div>

            <div className="border-t border-line px-4 py-4 sm:px-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-medium text-muted">เทมเพลตปัจจุบัน</p>
                  <p className="mt-1 text-[13px] font-semibold text-ink">{getPortfolioTemplate(form.layout)?.label}</p>
                </div>
                <button type="button" onClick={() => document.getElementById('portfolio-design')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="inline-flex h-9 items-center rounded-full border border-line px-4 text-[11px] font-semibold text-ink transition active:scale-95">เปลี่ยนเทมเพลต</button>
              </div>
              <div className="mt-3 overflow-hidden rounded-control border border-line">
                <GalleryLayoutPreview layout={form.gallery_layout || 'carousel'} images={form.gallery_urls} active={false} />
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

function Card({
  id,
  title,
  hint,
  children,
}: {
  id?: string
  title: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-20 overflow-hidden rounded-hero border border-line bg-surface shadow-card">
      <div className="border-b border-line bg-[linear-gradient(110deg,var(--ciiya-surface),var(--ciiya-ground))] px-5 py-5 sm:px-6">
        <div className="flex items-start gap-3">
          <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gold" />
          <div>
            <h2 className="text-[18px] font-semibold tracking-[-0.025em]">{title}</h2>
            <p className="mt-1 text-[12px] font-normal leading-relaxed text-muted">{hint}</p>
          </div>
        </div>
      </div>
      <div className="space-y-4 px-5 py-5 sm:px-6 sm:py-6">{children}</div>
    </section>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="block" role="group" aria-label={label}>
      <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
        {label}
      </span>
      {children}
    </div>
  )
}

function TemplatePreview({
  template,
  portfolio,
  featured = false,
}: {
  template: Portfolio['layout']
  portfolio: Portfolio
  featured?: boolean
}) {
  const images = [portfolio.hero_photo_url, ...portfolio.gallery_urls].filter(
    Boolean
  ) as string[]
  const name = portfolio.display_name?.trim() || 'Your name'
  const tagline = portfolio.tagline?.trim() || 'The story and work that’s you'
  const shell = featured ? 'aspect-[9/16] max-h-[680px]' : 'aspect-[9/16]'

  return (
    <div data-accent={portfolio.accent} className={`relative ${shell} overflow-hidden border-b border-line`}>
      <PortfolioTemplateHero
        layout={template}
        name={name}
        tagline={tagline}
        location={portfolio.location}
        images={images}
        compact
        previewDevice="mobile"
        className="h-full"
      />
      {featured ? (
        <div className="absolute bottom-2 right-2 rounded-full bg-black/45 px-2 py-1 text-[7px] font-medium text-white backdrop-blur">
          {GALLERY_LAYOUTS.find((item) => item.key === portfolio.gallery_layout)?.label || 'Slide'}
        </div>
      ) : null}
    </div>
  )
}

function MiniPhoto({ url, className = '' }: { url?: string; className?: string }) {
  return (
    <span className={`relative block overflow-hidden bg-line-strong ${className}`}>
      {url ? (
        <Image src={url} alt="" fill unoptimized sizes="320px" className="object-cover" />
      ) : (
        <span className="absolute inset-0 bg-[linear-gradient(145deg,var(--pf-accent-soft),var(--ciiya-line-strong))]" />
      )}
    </span>
  )
}

function GalleryLayoutPreview({
  layout,
  images,
  active,
}: {
  layout: Portfolio['gallery_layout']
  images: string[]
  active: boolean
}) {
  const photo = (index: number) =>
    images.length > 0 ? images[index % images.length] : undefined
  const tile = (index: number, className: string) => (
    <MiniPhoto key={`${layout}-${index}`} url={photo(index)} className={className} />
  )

  return (
    <div className={`grid aspect-[4/5] gap-1 border-b p-2 ${active ? 'border-gold/30 bg-gold-soft/35' : 'border-line bg-ground-sunken'}`} aria-hidden>
      {layout === 'carousel' ? (
        <div className="flex gap-1 overflow-hidden">{[0, 1, 2].map((i) => tile(i, 'h-full w-[60%] shrink-0 rounded-[4px]'))}</div>
      ) : layout === 'filmstrip' ? (
        <div className="flex items-center gap-1 overflow-hidden">{[0, 1, 2].map((i) => tile(i, 'aspect-[16/10] w-[72%] shrink-0 rounded-[4px]'))}</div>
      ) : layout === 'grid' ? (
        <div className="grid grid-cols-3 grid-rows-2 gap-1">{[0, 1, 2, 3, 4, 5].map((i) => tile(i, 'rounded-[3px]'))}</div>
      ) : layout === 'masonry' ? (
        <div className="grid grid-cols-3 grid-rows-3 gap-1">{tile(0, 'row-span-2 rounded-[3px]')}{tile(1, 'rounded-[3px]')}{tile(2, 'row-span-2 rounded-[3px]')}{tile(3, 'row-span-2 rounded-[3px]')}{tile(4, 'row-span-2 rounded-[3px]')}{tile(5, 'rounded-[3px]')}</div>
      ) : layout === 'collage' ? (
        <div className="grid grid-cols-3 grid-rows-2 gap-1">{tile(0, 'col-span-2 row-span-2 rounded-[3px]')}{tile(1, 'rounded-[3px]')}{tile(2, 'rounded-[3px]')}</div>
      ) : layout === 'collage_story' ? (
        <div className="grid grid-cols-4 grid-rows-2 gap-1">{tile(0, 'col-span-2 row-span-2 rounded-[3px]')}{tile(1, 'col-span-2 rounded-[3px]')}{tile(2, 'rounded-[3px]')}{tile(3, 'rounded-[3px]')}</div>
      ) : layout === 'collage_panorama' ? (
        <div className="grid grid-cols-3 grid-rows-2 gap-1">{tile(0, 'col-span-3 rounded-[3px]')}{tile(1, 'rounded-[3px]')}{tile(2, 'rounded-[3px]')}{tile(3, 'rounded-[3px]')}</div>
      ) : layout === 'collage_overlap' ? (
        <div className="relative h-full overflow-hidden">{tile(0, 'absolute left-0 top-[8%] h-[72%] w-[58%] -rotate-3 rounded-[5px] border-2 border-white shadow-card')}{tile(1, 'absolute right-0 top-[20%] h-[72%] w-[58%] rotate-3 rounded-[5px] border-2 border-white shadow-card')}{tile(2, 'absolute bottom-0 left-[30%] h-[45%] w-[42%] rounded-[5px] border-2 border-white shadow-card')}</div>
      ) : layout === 'collage_frames' ? (
        <div className="flex h-full flex-col gap-1.5 overflow-hidden bg-[#eee7dc] p-1">{tile(0, 'h-[45%] w-[76%] self-start rounded-[3px] border-2 border-white shadow-card')}{tile(1, 'h-[45%] w-[76%] self-end rounded-[3px] border-2 border-white shadow-card')}</div>
      ) : (
        <div className="grid grid-cols-4 grid-rows-3 gap-1">{tile(0, 'col-span-2 row-span-2 rounded-[3px]')}{tile(1, 'col-span-2 rounded-[3px]')}{tile(2, 'row-span-2 rounded-[3px]')}{tile(3, 'rounded-[3px]')}{tile(4, 'col-span-2 rounded-[3px]')}</div>
      )}
    </div>
  )
}

function SortableGalleryImage({
  url,
  index,
  onRemove,
}: {
  url: string
  index: number
  onRemove: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: url })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group relative aspect-square overflow-hidden rounded-card bg-ground-sunken shadow-card ${isDragging ? 'z-20 scale-[1.03] opacity-80 shadow-float' : ''}`}
    >
      <Image
        src={url}
        alt={`Photo in Portfolio Position ${index + 1}`}
        fill
        draggable={false}
        unoptimized
        sizes="120px"
        className="pointer-events-none object-cover"
      />
      <span className="absolute bottom-1.5 left-1.5 grid h-6 min-w-6 place-items-center rounded-full bg-ink/75 px-1.5 text-[10px] font-semibold text-white backdrop-blur">
        {index + 1}
      </span>
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Drag to move photo ${index + 1}`}
        className="absolute left-1.5 top-1.5 grid h-8 w-8 touch-none cursor-grab place-items-center rounded-full bg-white/90 text-ink shadow-card backdrop-blur active:cursor-grabbing"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-4 w-4">
          <circle cx="8" cy="7" r="1.4" />
          <circle cx="16" cy="7" r="1.4" />
          <circle cx="8" cy="12" r="1.4" />
          <circle cx="16" cy="12" r="1.4" />
          <circle cx="8" cy="17" r="1.4" />
          <circle cx="16" cy="17" r="1.4" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Delete photo ${index + 1}`}
        className="absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-full bg-ink/80 text-white backdrop-blur transition active:scale-90"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden className="h-3.5 w-3.5">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  )
}

function UploadProgress({ value, label }: { value: number; label: string }) {
  const safeValue = Math.min(100, Math.max(0, value))

  return (
    <div
      className="rounded-control border border-line bg-ground-sunken px-3.5 py-3"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-3 text-[11px] font-medium">
        <span className="truncate text-ink">{label || 'Uploading'}</span>
        <span className="shrink-0 tabular-nums text-gold-deep">{safeValue}%</span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={safeValue}
      >
        <div
          className="h-full rounded-full bg-gold transition-[width] duration-300 ease-out"
          style={{ width: `${safeValue}%` }}
        />
      </div>
    </div>
  )
}

function ContactChannel({
  label,
  hint,
  value,
  enabled,
  onChange,
  onToggle,
  placeholder,
  inputMode = 'url',
}: {
  label: string
  hint: string
  value: string
  enabled: boolean
  onChange: (value: string) => void
  onToggle: () => void
  placeholder: string
  inputMode?: 'tel' | 'email' | 'url'
}) {
  const visible = enabled && value.trim().length > 0

  return (
    <section
      className={`rounded-panel border p-3.5 transition ${
        enabled ? 'border-line bg-surface' : 'border-transparent bg-ground-sunken/70'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-ink">{label}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{hint}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={`${enabled ? 'Hide' : 'Show'} ${label}`}
          onClick={onToggle}
          className={`relative h-7 w-12 shrink-0 rounded-full p-1 transition ${
            enabled ? 'bg-ink' : 'bg-line-strong'
          }`}
        >
          <span
            className={`block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
              enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      <input
        value={value}
        onChange={(event) => onChange(event.target.value.slice(0, 240))}
        placeholder={placeholder}
        inputMode={inputMode}
        autoCapitalize="none"
        autoCorrect="off"
        className="mt-3 h-11 w-full rounded-control border border-line bg-ground px-3 text-[13px] font-normal text-ink outline-none placeholder:text-muted/65 focus:border-line-strong disabled:opacity-60"
      />

      <p
        className={`mt-2 text-[10px] font-medium ${
          visible ? 'text-gold-deep' : 'text-muted'
        }`}
      >
        {visible
          ? 'Shown on client page'
          : enabled
            ? 'Add details to show this channel'
            : 'Hidden from client page'}
      </p>
    </section>
  )
}

function Input({
  value,
  onChange,
  placeholder,
  maxLength,
  inputMode,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  maxLength?: number
  inputMode?: 'tel' | 'email' | 'url'
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      inputMode={inputMode}
      className="h-12 w-full rounded-control border border-line bg-ground-sunken px-3.5 text-[15px] font-normal text-ink outline-none placeholder:text-muted/70 focus:border-line-strong"
    />
  )
}
