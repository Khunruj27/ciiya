'use client'

import { useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useI18n } from '@/components/i18n-provider'

export default function AuthPasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false)
  const { locale } = useI18n()
  const label = locale === 'th' ? (visible ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน') : (visible ? 'Hide password' : 'Show password')
  return (
    <div className="relative">
      <input {...props} type={visible ? 'text' : 'password'} style={{ ...props.style, paddingRight: 52 }} />
      <button type="button" aria-label={label} aria-pressed={visible} onClick={() => setVisible(!visible)} className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-muted">
        {visible ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
      </button>
    </div>
  )
}
