'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

type GuestMoment = {
  id: string
  guest_name: string
  message: string | null
  image_urls: string[]
  like_count?: number | null
  created_at: string
}

type Props = {
  token: string
  active: boolean
  onCountChange?: (count: number) => void
}

const MAX_FILES = 4
const STORY_DURATION_MS = 6000

type StoryPosition = {
  momentIndex: number
  imageIndex: number
}

function formatMomentTime(value: string) {
  const date = new Date(value)
  const difference = Date.now() - date.getTime()
  const minutes = Math.max(1, Math.floor(difference / 60_000))

  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr ago`

  return new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  }).format(date)
}

export default function GuestMoments({ token, active, onCountChange }: Props) {
  const [moments, setMoments] = useState<GuestMoment[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [composerOpen, setComposerOpen] = useState(false)
  const [guestName, setGuestName] = useState('')
  const [message, setMessage] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [formError, setFormError] = useState('')
  const [activeStory, setActiveStory] = useState<StoryPosition | null>(null)
  const [storyProgress, setStoryProgress] = useState(0)
  const [storyPaused, setStoryPaused] = useState(false)
  const [storyHeld, setStoryHeld] = useState(false)
  const [sharedId, setSharedId] = useState<string | null>(null)
  const [likedMomentIds, setLikedMomentIds] = useState<Set<string>>(new Set())
  const [shareStatus, setShareStatus] = useState('')
  const loadedRef = useRef(false)
  const storyPressStartedRef = useRef(0)
  const suppressStoryTapRef = useRef(false)

  const previews = useMemo(
    () => files.map((file) => URL.createObjectURL(file)),
    [files]
  )

  useEffect(() => {
    return () => previews.forEach((url) => URL.revokeObjectURL(url))
  }, [previews])

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(`ciiya-liked-moments-${token}`) || '[]')
      setLikedMomentIds(new Set(Array.isArray(saved) ? saved : []))
    } catch {
      setLikedMomentIds(new Set())
    }
  }, [token])

  useEffect(() => {
    if (!active || loadedRef.current) return
    loadedRef.current = true

    const controller = new AbortController()

    async function loadMoments() {
      try {
        setLoading(true)
        const res = await fetch(`/api/share/moments?token=${encodeURIComponent(token)}`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        const data = await res.json()
        if (!res.ok || !data.success) throw new Error(data?.error || 'Unable to load moments')

        const nextMoments = Array.isArray(data.moments) ? data.moments : []
        setMoments(nextMoments)
        onCountChange?.(nextMoments.length)
        setLoadError('')

        window.requestAnimationFrame(() => {
          const targetId = window.location.hash.startsWith('#moment-')
            ? window.location.hash.slice(1)
            : ''
          if (targetId) document.getElementById(targetId)?.scrollIntoView({ block: 'center' })
        })
      } catch (error) {
        if (controller.signal.aborted) return
        setLoadError(error instanceof Error ? error.message : 'Unable to load moments')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    loadMoments()
    return () => controller.abort()
  }, [active, onCountChange, token])

  useEffect(() => {
    if (!composerOpen && !activeStory) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [activeStory, composerOpen])

  useEffect(() => {
    if (!activeStory || storyPaused) return

    const startingProgress = storyProgress
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      const nextProgress = Math.min(100, startingProgress + ((Date.now() - startedAt) / STORY_DURATION_MS) * 100)
      setStoryProgress(nextProgress)
      if (nextProgress >= 100) goNextStory()
    }, 60)

    return () => window.clearInterval(timer)
  }, [activeStory, moments, storyPaused])

  useEffect(() => {
    if (!activeStory) return

    function handleStoryKeys(event: KeyboardEvent) {
      if (event.key === 'Escape') setActiveStory(null)
      if (event.key === 'ArrowRight') goNextStory()
      if (event.key === 'ArrowLeft') goPreviousStory()
    }

    window.addEventListener('keydown', handleStoryKeys)
    return () => window.removeEventListener('keydown', handleStoryKeys)
  }, [activeStory, moments])

  function resetComposer() {
    setComposerOpen(false)
    setMessage('')
    setFiles([])
    setUploadProgress(0)
    setFormError('')
  }

  function chooseFiles(nextFiles: File[]) {
    const images = nextFiles.filter((file) => file.type.startsWith('image/')).slice(0, MAX_FILES)
    setFiles(images)
    setFormError(nextFiles.length > MAX_FILES ? `You can share up to ${MAX_FILES} photos at once.` : '')
  }

  function submitMoment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (uploading) return

    if (!guestName.trim()) {
      setFormError('Please enter your name.')
      return
    }

    if (files.length === 0) {
      setFormError('Choose at least one photo.')
      return
    }

    const body = new FormData()
    body.set('token', token)
    body.set('guestName', guestName.trim())
    body.set('message', message.trim())
    files.forEach((file) => body.append('files', file))

    setUploading(true)
    setUploadProgress(4)
    setFormError('')

    const request = new XMLHttpRequest()
    request.open('POST', '/api/share/moments')
    request.responseType = 'json'
    request.upload.onprogress = (progressEvent) => {
      if (!progressEvent.lengthComputable) return
      setUploadProgress(Math.max(4, Math.round((progressEvent.loaded / progressEvent.total) * 92)))
    }
    request.onerror = () => {
      setUploading(false)
      setFormError('The upload was interrupted. Please try again.')
    }
    request.onload = () => {
      const response = request.response
      if (request.status < 200 || request.status >= 300 || !response?.success) {
        setUploading(false)
        setFormError(response?.error || 'Unable to share this moment.')
        return
      }

      setUploadProgress(100)
      const nextMoments = [response.moment as GuestMoment, ...moments]
      setMoments(nextMoments)
      onCountChange?.(nextMoments.length)
      window.setTimeout(() => {
        setUploading(false)
        resetComposer()
      }, 350)
    }
    request.send(body)
  }

  async function shareMoment(moment: GuestMoment) {
    const url = getMomentUrl(moment)

    setStoryPaused(true)
    try {
      if (navigator.share) {
        await navigator.share({
          title: `Moment from ${moment.guest_name}`,
          text: moment.message || 'A guest moment shared on Ciiya',
          url,
        })
      } else {
        await navigator.clipboard.writeText(url)
      }

      setSharedId(moment.id)
      setShareStatus('Shared')
      window.setTimeout(() => setSharedId((current) => current === moment.id ? null : current), 1800)
      window.setTimeout(() => setShareStatus(''), 1800)
    } catch {
    } finally {
      setStoryPaused(false)
    }
  }

  function getMomentUrl(moment: GuestMoment) {
    return `${window.location.origin}${window.location.pathname}#moment-${moment.id}`
  }

  function persistLikedMoments(next: Set<string>) {
    setLikedMomentIds(next)
    window.localStorage.setItem(`ciiya-liked-moments-${token}`, JSON.stringify(Array.from(next)))
  }

  async function toggleMomentLike(moment: GuestMoment) {
    const wasLiked = likedMomentIds.has(moment.id)
    const optimisticIds = new Set(likedMomentIds)
    if (wasLiked) optimisticIds.delete(moment.id)
    else optimisticIds.add(moment.id)

    persistLikedMoments(optimisticIds)
    setMoments((current) => current.map((item) => item.id === moment.id
      ? { ...item, like_count: Math.max(0, Number(item.like_count || 0) + (wasLiked ? -1 : 1)) }
      : item))

    try {
      const res = await fetch('/api/share/moments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, momentId: moment.id }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data?.error || 'Reaction failed')

      setLikedMomentIds((current) => {
        const confirmedIds = new Set(current)
        if (data.liked) confirmedIds.add(moment.id)
        else confirmedIds.delete(moment.id)
        window.localStorage.setItem(`ciiya-liked-moments-${token}`, JSON.stringify(Array.from(confirmedIds)))
        return confirmedIds
      })
      setMoments((current) => current.map((item) => item.id === moment.id
        ? { ...item, like_count: Number(data.likeCount || 0) }
        : item))
    } catch {
      setLikedMomentIds((current) => {
        const rollbackIds = new Set(current)
        if (wasLiked) rollbackIds.add(moment.id)
        else rollbackIds.delete(moment.id)
        window.localStorage.setItem(`ciiya-liked-moments-${token}`, JSON.stringify(Array.from(rollbackIds)))
        return rollbackIds
      })
      setMoments((current) => current.map((item) => item.id === moment.id
        ? { ...item, like_count: Math.max(0, Number(item.like_count || 0) + (wasLiked ? 1 : -1)) }
        : item))
    }
  }

  function shareToFacebook(moment: GuestMoment) {
    setStoryPaused(true)
    const shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(getMomentUrl(moment))}`
    const popup = window.open(shareUrl, '_blank', 'noopener,noreferrer')
    if (popup) popup.opener = null
    setShareStatus('Facebook opened')
    window.setTimeout(() => { setShareStatus(''); setStoryPaused(false) }, 1600)
  }

  async function shareToInstagram(moment: GuestMoment, imageUrl: string) {
    setStoryPaused(true)
    setShareStatus('Preparing…')

    try {
      const response = await fetch(imageUrl)
      const blob = await response.blob()
      const file = new File([blob], 'ciiya-moment.jpg', { type: blob.type || 'image/jpeg' })
      const shareData = { files: [file], text: moment.message || `Moment from ${moment.guest_name}` }

      if (navigator.share && navigator.canShare?.(shareData)) {
        await navigator.share(shareData)
      } else if (navigator.share) {
        await navigator.share({ title: `Moment from ${moment.guest_name}`, text: shareData.text, url: getMomentUrl(moment) })
      } else {
        await navigator.clipboard.writeText(getMomentUrl(moment))
        window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer')
      }

      setShareStatus('Ready to share')
    } catch {
      setShareStatus('Share cancelled')
    } finally {
      window.setTimeout(() => setShareStatus(''), 1800)
      setStoryPaused(false)
    }
  }

  function openStory(momentIndex: number, imageIndex = 0) {
    setStoryProgress(0)
    setStoryPaused(false)
    setStoryHeld(false)
    setShareStatus('')
    setActiveStory({ momentIndex, imageIndex })
  }

  function startStoryPress(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return
    storyPressStartedRef.current = window.performance.now()
    suppressStoryTapRef.current = false
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setStoryHeld(true)
    setStoryPaused(true)
  }

  function endStoryPress(event: React.PointerEvent<HTMLButtonElement>) {
    const heldFor = window.performance.now() - storyPressStartedRef.current
    suppressStoryTapRef.current = heldFor >= 220
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setStoryHeld(false)
    setStoryPaused(false)
  }

  function cancelStoryPress() {
    storyPressStartedRef.current = 0
    suppressStoryTapRef.current = false
    setStoryHeld(false)
    setStoryPaused(false)
  }

  function handleStoryTap(direction: 'previous' | 'next') {
    if (suppressStoryTapRef.current) {
      suppressStoryTapRef.current = false
      return
    }

    if (direction === 'previous') goPreviousStory()
    else goNextStory()
  }

  function goNextStory() {
    setStoryProgress(0)
    setActiveStory((current) => {
      if (!current) return null
      const currentMoment = moments[current.momentIndex]
      if (!currentMoment) return null

      if (current.imageIndex < currentMoment.image_urls.length - 1) {
        return { ...current, imageIndex: current.imageIndex + 1 }
      }

      if (current.momentIndex < moments.length - 1) {
        return { momentIndex: current.momentIndex + 1, imageIndex: 0 }
      }

      return null
    })
  }

  function goPreviousStory() {
    setStoryProgress(0)
    setActiveStory((current) => {
      if (!current) return null

      if (current.imageIndex > 0) {
        return { ...current, imageIndex: current.imageIndex - 1 }
      }

      if (current.momentIndex > 0) {
        const previousMomentIndex = current.momentIndex - 1
        return {
          momentIndex: previousMomentIndex,
          imageIndex: Math.max(0, moments[previousMomentIndex].image_urls.length - 1),
        }
      }

      return current
    })
  }

  const activeStoryMoment = activeStory ? moments[activeStory.momentIndex] : null
  const activeStoryImage = activeStoryMoment && activeStory
    ? activeStoryMoment.image_urls[activeStory.imageIndex]
    : null
  const activeStoryLiked = activeStoryMoment ? likedMomentIds.has(activeStoryMoment.id) : false

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-hero border border-line bg-surface shadow-card">
        <div className="relative px-5 py-7 sm:px-8 sm:py-9">
          <div aria-hidden className="absolute -right-16 -top-20 h-48 w-48 rounded-full bg-gold/20 blur-3xl" />
          <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-xl">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-deep">From everyone at the event</p>
              <h2 className="mt-3 text-[30px] font-semibold leading-tight tracking-[-0.035em] sm:text-[38px]">Guest moments</h2>
              <p className="mt-3 text-[13px] leading-6 text-muted sm:text-[14px]">Share the moments you captured. They stay separate from the photographer’s gallery.</p>
            </div>
            <button
              type="button"
              onClick={() => setComposerOpen(true)}
              className="flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-ink px-6 text-[13px] font-semibold text-white shadow-float transition active:scale-95"
            >
              <PlusIcon /> Share a moment
            </button>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((item) => <div key={item} className="h-72 animate-pulse rounded-hero bg-surface" />)}
        </div>
      ) : loadError ? (
        <div className="rounded-hero border border-line bg-surface px-6 py-12 text-center">
          <p className="text-[15px] font-semibold">Moments are unavailable right now</p>
          <p className="mt-2 text-[12px] text-muted">{loadError}</p>
        </div>
      ) : moments.length === 0 ? (
        <button
          type="button"
          onClick={() => setComposerOpen(true)}
          className="group flex w-full flex-col items-center rounded-hero border border-dashed border-line-strong bg-surface px-6 py-16 text-center transition hover:border-gold"
        >
          <span className="grid h-14 w-14 place-items-center rounded-full bg-gold-soft text-gold-deep transition group-hover:scale-105"><CameraIcon /></span>
          <span className="mt-5 text-[19px] font-semibold">Be the first to share a moment</span>
          <span className="mt-2 max-w-sm text-[13px] leading-6 text-muted">Add a photo from your phone for everyone at this event to enjoy.</span>
        </button>
      ) : (
        <>
          <div className="mx-auto grid w-full max-w-4xl grid-cols-4 gap-x-0 gap-y-4 sm:gap-x-2 sm:gap-y-7 lg:gap-x-1">
            {moments.map((moment, momentIndex) => (
              <button
                id={`moment-${moment.id}`}
                type="button"
                key={moment.id}
                onClick={() => openStory(momentIndex)}
                className="group flex min-w-0 scroll-mt-28 flex-col items-center pb-1 pt-1"
                aria-label={`Open moment from ${moment.guest_name}`}
              >
                <span className="moment-story-ring relative block aspect-square w-full max-w-[96px] overflow-hidden rounded-full bg-gold p-[2px] shadow-card transition duration-300 group-hover:-translate-y-0.5 group-hover:shadow-lift group-active:scale-95 sm:max-w-[180px] lg:max-w-[220px]">
                  <span className="relative z-10 block h-full w-full rounded-full bg-surface p-[3px]">
                    <img src={moment.image_urls[0]} alt={`Moment shared by ${moment.guest_name}`} loading="lazy" className="h-full w-full rounded-full object-cover" />
                  </span>
                  {moment.image_urls.length > 1 ? (
                    <span className="absolute bottom-0 right-0 z-20 grid h-5 min-w-5 place-items-center rounded-full border-2 border-surface bg-ink px-1 text-[7px] font-semibold text-white sm:h-7 sm:min-w-7 sm:text-[9px]">+{moment.image_urls.length - 1}</span>
                  ) : null}
                </span>
                <span className="mt-2 block w-full truncate text-center text-[9px] font-semibold leading-tight text-ink sm:mt-3 sm:text-[11px]">{moment.guest_name}</span>
                <span className="mt-1 block text-center text-[7px] font-normal leading-none text-muted sm:text-[9px]">{formatMomentTime(moment.created_at)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {composerOpen ? (
        <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-label="Share a guest moment">
          <form onSubmit={submitMoment} className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[26px] bg-surface p-5 shadow-float sm:rounded-hero sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gold-deep">Guest moments</p><h3 className="mt-2 text-[24px] font-semibold tracking-[-0.03em]">Share what you captured</h3></div>
              <button type="button" onClick={resetComposer} disabled={uploading} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ground text-[20px] disabled:opacity-40" aria-label="Close">×</button>
            </div>

            <label className="mt-6 block text-[12px] font-semibold">Your name</label>
            <input value={guestName} onChange={(event) => setGuestName(event.target.value.slice(0, 60))} disabled={uploading} placeholder="How should your name appear?" className="mt-2 h-12 w-full rounded-control border border-line bg-ground px-4 text-[14px] outline-none transition focus:border-gold disabled:opacity-60" />

            <label className="mt-5 block text-[12px] font-semibold">Photos</label>
            <label className="mt-2 flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-panel border border-dashed border-line-strong bg-ground px-4 py-5 text-center transition hover:border-gold">
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={uploading} onChange={(event) => chooseFiles(Array.from(event.target.files || []))} className="sr-only" />
              <span className="grid h-11 w-11 place-items-center rounded-full bg-gold-soft text-gold-deep"><CameraIcon /></span>
              <span className="mt-3 text-[13px] font-semibold">Choose up to 4 photos</span>
              <span className="mt-1 text-[10px] text-muted">JPEG, PNG or WEBP · 12MB each · 32MB total</span>
            </label>

            {previews.length > 0 ? (
              <div className="mt-3 grid grid-cols-4 gap-2">
                {previews.map((url, index) => <img key={url} src={url} alt={`Selected photo ${index + 1}`} className="aspect-square w-full rounded-card object-cover" />)}
              </div>
            ) : null}

            <label className="mt-5 block text-[12px] font-semibold">Message <span className="font-normal text-muted">(optional)</span></label>
            <textarea value={message} onChange={(event) => setMessage(event.target.value.slice(0, 280))} disabled={uploading} rows={3} placeholder="Say something about this moment…" className="mt-2 w-full resize-none rounded-control border border-line bg-ground px-4 py-3 text-[14px] leading-6 outline-none transition focus:border-gold disabled:opacity-60" />
            <p className="mt-1 text-right text-[10px] text-muted">{message.length}/280</p>

            {formError ? <p className="mt-3 rounded-control bg-rose-soft px-4 py-3 text-[12px] font-medium text-rose">{formError}</p> : null}

            {uploading ? (
              <div className="mt-4"><div className="flex items-center justify-between text-[11px] font-medium"><span>{uploadProgress < 100 ? 'Sharing your moment…' : 'Moment shared'}</span><span>{uploadProgress}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-ground-sunken"><div className="h-full rounded-full bg-gold transition-[width] duration-300" style={{ width: `${uploadProgress}%` }} /></div></div>
            ) : null}

            <button type="submit" disabled={uploading} className="mt-5 flex h-12 w-full items-center justify-center rounded-full bg-ink px-6 text-[13px] font-semibold text-white transition active:scale-[0.99] disabled:opacity-60">{uploading ? 'Uploading…' : 'Share moment'}</button>
          </form>
        </div>
      ) : null}

      {activeStory && activeStoryMoment && activeStoryImage ? (
        <div className="fixed inset-0 z-[130] grid place-items-center bg-black sm:bg-black/95 sm:p-5" role="dialog" aria-modal="true" aria-label="Guest moment story">
          <div className="relative h-[100dvh] w-full max-w-[460px] select-none overflow-hidden bg-[#111] text-white shadow-2xl sm:h-[min(900px,94dvh)] sm:rounded-[28px]" onContextMenu={(event) => event.preventDefault()}>
            <img src={activeStoryImage} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl" />
            <div className="absolute inset-0 bg-black/30" />
            <img src={activeStoryImage} alt={`Moment shared by ${activeStoryMoment.guest_name}`} className="pointer-events-none absolute inset-0 h-full w-full object-contain" />

            <button type="button" onClick={() => handleStoryTap('previous')} onPointerDown={startStoryPress} onPointerUp={endStoryPress} onPointerCancel={cancelStoryPress} className="absolute inset-y-0 left-0 z-10 w-[38%] touch-none cursor-w-resize" aria-label="Previous story" />
            <button type="button" onClick={() => handleStoryTap('next')} onPointerDown={startStoryPress} onPointerUp={endStoryPress} onPointerCancel={cancelStoryPress} className="absolute inset-y-0 right-0 z-10 w-[62%] touch-none cursor-e-resize" aria-label="Next story" />

            {storyHeld ? (
              <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
                <span className="grid h-14 w-14 place-items-center rounded-full border border-white/25 bg-black/35 backdrop-blur-md" aria-hidden>
                  <PauseIcon />
                </span>
              </div>
            ) : null}

            <div className="pointer-events-none absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-black/75 via-black/25 to-transparent px-3 pb-16 pt-[max(12px,env(safe-area-inset-top))] sm:px-4 sm:pt-4">
              <div className="flex gap-1.5">
                {activeStoryMoment.image_urls.map((url, index) => (
                  <span key={url} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/30">
                    <span
                      className="block h-full rounded-full bg-white"
                      style={{ width: `${index < activeStory.imageIndex ? 100 : index === activeStory.imageIndex ? storyProgress : 0}%` }}
                    />
                  </span>
                ))}
              </div>

              <div className="mt-3 flex items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/30 bg-gold-soft text-[12px] font-semibold uppercase text-gold-deep">{activeStoryMoment.guest_name.slice(0, 1)}</span>
                <div className="min-w-0 flex-1"><p className="truncate text-[12px] font-semibold">{activeStoryMoment.guest_name}</p><p className="mt-0.5 text-[9px] text-white/65">{formatMomentTime(activeStoryMoment.created_at)} · {activeStory.momentIndex + 1}/{moments.length}</p></div>
                <button type="button" onClick={() => setActiveStory(null)} className="pointer-events-auto grid h-10 w-10 place-items-center rounded-full bg-white/10 text-[23px] backdrop-blur" aria-label="Close story">×</button>
              </div>
            </div>

            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/90 via-black/45 to-transparent px-4 pb-[max(18px,env(safe-area-inset-bottom))] pt-28 sm:px-5 sm:pb-6">
              {activeStoryMoment.message ? <p className="max-w-[90%] text-[13px] font-normal leading-[1.65] tracking-[-0.01em] text-white sm:text-[14px]">{activeStoryMoment.message}</p> : null}

              <div className="pointer-events-auto mt-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleMomentLike(activeStoryMoment)}
                  className={`flex h-11 min-w-[72px] items-center justify-center gap-2 rounded-full border px-4 text-[11px] font-semibold backdrop-blur transition active:scale-95 ${activeStoryLiked ? 'border-rose/70 bg-rose text-white' : 'border-white/25 bg-black/25 text-white'}`}
                  aria-label={activeStoryLiked ? 'Unlike this moment' : 'Like this moment'}
                  aria-pressed={activeStoryLiked}
                >
                  <HeartIcon filled={activeStoryLiked} />
                  <span>{Number(activeStoryMoment.like_count || 0)}</span>
                </button>
                <button type="button" onClick={() => shareToFacebook(activeStoryMoment)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/25 bg-black/25 text-white backdrop-blur transition active:scale-95" aria-label="Share to Facebook"><FacebookIcon /></button>
                <button type="button" onClick={() => shareToInstagram(activeStoryMoment, activeStoryImage)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/25 bg-black/25 text-white backdrop-blur transition active:scale-95" aria-label="Share to Instagram"><InstagramIcon /></button>
                <button type="button" onClick={() => shareMoment(activeStoryMoment)} className="flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-full border border-white/25 bg-white px-3 text-[11px] font-semibold text-ink transition active:scale-[0.98]" aria-label="Open more sharing options"><ShareIcon /> <span className="truncate">{sharedId === activeStoryMoment.id ? 'Shared' : 'Share'}</span></button>
              </div>

              {shareStatus ? <p className="mt-2 text-center text-[9px] font-medium tracking-wide text-white/70">{shareStatus}</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function PlusIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden className="h-4 w-4"><path d="M12 5v14M5 12h14" /></svg>
}

function CameraIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-5 w-5"><path d="M14.5 5 13 3h-2L9.5 5H6a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3V8a3 3 0 0 0-3-3h-3.5Z" /><circle cx="12" cy="12.5" r="4" /></svg>
}

function ShareIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-3.5 w-3.5"><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5" /></svg>
}

function HeartIcon({ filled = false }: { filled?: boolean }) {
  return <svg viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-4 w-4"><path d="M20.8 4.7a5.5 5.5 0 0 0-7.8 0L12 5.8l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.4 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" /></svg>
}

function FacebookIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-4 w-4"><path d="M13.7 21v-8h2.7l.4-3.1h-3.1v-2c0-.9.3-1.5 1.6-1.5H17V3.6c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.1H7.5V13h2.8v8h3.4Z" /></svg>
}

function InstagramIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-4 w-4"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg>
}

function PauseIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-5 w-5"><rect x="6.5" y="5" width="4" height="14" rx="1" /><rect x="13.5" y="5" width="4" height="14" rx="1" /></svg>
}
