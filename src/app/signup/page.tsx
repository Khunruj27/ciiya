'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-client'

export default function SignupPage() {
  const router = useRouter()
  const supabase = createClient()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')
    setSuccessMsg('')

    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    })

    setLoading(false)

    if (error) {
      setErrorMsg(error.message)
      return
    }

    setSuccessMsg('Account created. Please check your email for confirmation.')
    router.push('/login')
    router.refresh()
  }

  return (
    <main className="min-h-screen bg-[#EFEFF1] px-4 pb-10 pt-20 text-black">
      <div className="mx-auto flex min-h-[calc(100dvh-100px)] w-full max-w-[390px] flex-col">
        <section>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[14px] font-bold text-black">
              <span className="h-3 w-3 rounded-full bg-black" />
              Get started
            </div>

            <Link
              href="/login"
              className="flex h-11 items-center justify-center rounded-full bg-white px-5 text-sm font-black text-black shadow-[0_10px_30px_rgba(15,23,42,0.06)] transition active:scale-95"
            >
              Log in
            </Link>
          </div>

          <h1 className="mt-8 text-[40px] font-black leading-[0.92] tracking-[-0.07em] text-black sm:text-[48px]">
            Create your
            <br />
            Ciiya account.
          </h1>

          <p className="mt-4 text-[15px] font-medium leading-6 text-slate-500 sm:text-[16px] sm:leading-7">
            Start managing albums and sharing photos with clients.
          </p>
        </section>

        <section className="pt-7">
          <form
            onSubmit={handleSignup}
            className="rounded-[30px] bg-white p-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:rounded-[34px] sm:p-5"
          >
            <div>
              <label className="text-sm font-black text-black/70">
                Email
              </label>

              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="mt-2 h-13 min-h-12 w-full rounded-[20px] border border-black/5 bg-[#F6F7FA] px-4 text-sm font-bold text-black outline-none placeholder:text-slate-400 focus:border-blue-600"
              />
            </div>

            <div className="mt-4">
              <label className="text-sm font-black text-black/70">
                Password
              </label>

              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a password"
                className="mt-2 h-13 min-h-12 w-full rounded-[20px] border border-black/5 bg-[#F6F7FA] px-4 text-sm font-bold text-black outline-none placeholder:text-slate-400 focus:border-blue-600"
              />
            </div>

            {errorMsg ? (
              <p className="mt-4 rounded-2xl bg-[#FFF1F1] px-4 py-3 text-sm font-bold text-red-500">
                {errorMsg}
              </p>
            ) : null}

            {successMsg ? (
              <p className="mt-4 rounded-2xl bg-[#EEFDF3] px-4 py-3 text-sm font-bold text-green-600">
                {successMsg}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="mt-5 flex h-13 min-h-12 w-full items-center justify-center rounded-full bg-blue-600 px-4 text-sm font-black text-white transition active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? 'Creating account...' : 'Sign Up'}
            </button>

            <p className="mt-5 text-center text-sm font-medium text-slate-500">
              Already have an account?{' '}
              <Link href="/login" className="font-black text-black">
                Log in
              </Link>
            </p>
          </form>
        </section>
      </div>
    </main>
  )
}