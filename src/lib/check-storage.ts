import { checkStorageLimit } from '@/lib/check-storage'

export async function POST(req: Request) {
  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const formData = await req.formData()
  const file = formData.get('file') as File

  if (!file) {
    return new Response('No file', { status: 400 })
  }

  const fileSize = file.size

  // ✅ เช็ค limit ตรงนี้
  const check = await checkStorageLimit(user.id, fileSize)

  if (!check.ok) {
    return new Response(
      JSON.stringify({
        error: 'Storage full. Please upgrade your plan.',
      }),
      { status: 400 }
    )
  }

  // 👉 ถ้าผ่าน ค่อย upload ต่อ
}
