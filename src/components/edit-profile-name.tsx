'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'

type Props = {
  initialName: string
}

export default function EditProfileName({ initialName }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(initialName || '')
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  async function saveName() {
    const nextName = name.trim()

    if (!nextName) {
      setErrorMsg('Please enter your profile name')
      return
    }

    try {
      setSaving(true)
      setErrorMsg('')

      const supabase = createClient()

      const { error } = await supabase.auth.updateUser({
        data: {
          full_name: nextName,
          name: nextName,
        },
      })

      if (error) throw error

      setOpen(false)
      router.refresh()
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-5 rounded-full bg-[#2F6BFF] px-5 py-2 text-sm font-bold text-white shadow-sm"
      >
        Edit Profile
      </button>

      {open ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-5 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-[32px] bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-black text-slate-900">
                  Edit Profile
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Update your display name.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xl text-slate-500"
                disabled={saving}
              >
                ×
              </button>
            </div>

            <div className="mt-5">
              <label className="text-xs font-semibold text-slate-500">
                Profile name
              </label>

              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setErrorMsg('')
                }}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-[#2F6BFF] focus:bg-white"
                placeholder="Your name"
                disabled={saving}
              />
            </div>

            {errorMsg ? (
              <p className="mt-3 text-sm text-red-500">{errorMsg}</p>
            ) : null}

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={saving}
                className="rounded-full bg-slate-100 px-4 py-3 text-sm font-bold text-slate-700 disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={saveName}
                disabled={saving}
                className="rounded-full bg-[#2F6BFF] px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}