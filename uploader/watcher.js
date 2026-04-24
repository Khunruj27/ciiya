const chokidar = require('chokidar')
const fs = require('fs')
const path = require('path')
const fetch = require('node-fetch')
const FormData = require('form-data')

// 🔥 ตั้งค่า
const WATCH_FOLDER = '/Users/yourname/Desktop/WATCH' // เปลี่ยน path
const API_URL = 'http://localhost:3000/api/photos/upload'

// 👀 watch folder
const watcher = chokidar.watch(WATCH_FOLDER, {
  persistent: true,
  ignoreInitial: true,
})

console.log('📸 Watching folder:', WATCH_FOLDER)

watcher.on('add', async (filePath) => {
  if (!filePath.toLowerCase().endsWith('.jpg')) return

  console.log('🆕 New file:', filePath)

  try {
    const form = new FormData()
    form.append('file', fs.createReadStream(filePath))
    form.append('albumId', 'YOUR_ALBUM_ID') // 🔥 ใส่จริง

    await fetch(API_URL, {
      method: 'POST',
      body: form,
    })

    console.log('✅ Uploaded:', path.basename(filePath))
  } catch (err) {
    console.error('❌ Upload failed:', err)
  }
})