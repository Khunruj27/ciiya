export type OptimisticUpload = {
  id: string
  fileName: string
  fileHash: string
  progress: number
  status: 'uploading' | 'queued' | 'processing' | 'error'
}

export const OPTIMISTIC_UPLOAD_EVENT =
  'ciiya:optimistic-upload'