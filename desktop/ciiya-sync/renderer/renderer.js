const bridge = window.ciiyaSync

const elements = {
  connectionPill: document.querySelector('#connection-pill'),
  connectionLabel: document.querySelector('#connection-label'),
  setupView: document.querySelector('#setup-view'),
  workspace: document.querySelector('#workspace'),
  pairIdle: document.querySelector('#pair-idle'),
  pairWaiting: document.querySelector('#pair-waiting'),
  connectButton: document.querySelector('#connect-button'),
  pairCode: document.querySelector('#pair-code'),
  pairExpiry: document.querySelector('#pair-expiry'),
  openPairingButton: document.querySelector('#open-pairing-button'),
  restartPairingButton: document.querySelector('#restart-pairing-button'),
  albumSelect: document.querySelector('#album-select'),
  refreshAlbumsButton: document.querySelector('#refresh-albums-button'),
  folderButton: document.querySelector('#folder-button'),
  folderName: document.querySelector('#folder-name'),
  folderPath: document.querySelector('#folder-path'),
  lightroomCard: document.querySelector('#lightroom-card'),
  lightroomStatus: document.querySelector('#lightroom-status'),
  installLightroomButton: document.querySelector('#install-lightroom-button'),
  autoStart: document.querySelector('#autostart-toggle'),
  syncButton: document.querySelector('#sync-button'),
  syncHeading: document.querySelector('#sync-heading'),
  syncMessage: document.querySelector('#sync-message'),
  syncError: document.querySelector('#sync-error'),
  heroDot: document.querySelector('#hero-dot'),
  sessionStatusChip: document.querySelector('#session-status-chip'),
  sessionStatusLabel: document.querySelector('#session-status-label'),
  sessionTitle: document.querySelector('#session-title'),
  sessionLocation: document.querySelector('#session-location'),
  sessionDuration: document.querySelector('#session-duration'),
  sessionDiscovered: document.querySelector('#session-discovered'),
  sessionDelivered: document.querySelector('#session-delivered'),
  sessionBytes: document.querySelector('#session-bytes'),
  networkState: document.querySelector('#network-state'),
  networkLabel: document.querySelector('#network-label'),
  lastActivity: document.querySelector('#last-activity'),
  totalCount: document.querySelector('#total-count'),
  activeCount: document.querySelector('#active-count'),
  completedCount: document.querySelector('#completed-count'),
  retryCount: document.querySelector('#retry-count'),
  failedCount: document.querySelector('#failed-count'),
  activityFeed: document.querySelector('#activity-feed'),
  emptyState: document.querySelector('#empty-state'),
  disconnectButton: document.querySelector('#disconnect-button'),
  releaseVersion: document.querySelector('#release-version'),
  toast: document.querySelector('#toast'),
}

const statusLabels = {
  queued: 'รอส่ง',
  hashing: 'ตรวจไฟล์',
  reserving: 'เตรียมพื้นที่',
  uploading: 'กำลังส่ง',
  finalizing: 'กำลังบันทึก',
  retry_wait: 'รอเครือข่าย',
  completed: 'สำเร็จ',
  duplicate: 'มีแล้ว',
  failed: 'ตรวจสอบ',
  cancelled: 'ยกเลิก',
}

const liveStatusLabels = {
  paused: 'พักอยู่',
  watching: 'รอภาพใหม่',
  syncing: 'กำลังส่งภาพ',
  waiting_network: 'รอเครือข่าย',
  needs_attention: 'ต้องตรวจสอบ',
}
let currentState = null
let toastTimer = null

function showToast(message) {
  clearTimeout(toastTimer)
  elements.toast.textContent = message
  elements.toast.hidden = false
  toastTimer = setTimeout(() => {
    elements.toast.hidden = true
  }, 3600)
}

function errorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || 'เกิดข้อผิดพลาด')
  return message.replace(/^Error invoking remote method '[^']+': Error:\s*/, '')
}

async function action(operation, busyElement) {
  if (busyElement) busyElement.disabled = true
  try {
    const state = await operation()
    if (state) render(state)
  } catch (error) {
    showToast(errorMessage(error))
  } finally {
    if (busyElement) busyElement.disabled = false
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function folderName(folderPath) {
  if (!folderPath) return 'ยังไม่ได้เลือกโฟลเดอร์'
  return folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath
}

function formatDuration(startedAt, endedAt) {
  if (!startedAt) return '00:00:00'
  const start = Date.parse(startedAt)
  const end = endedAt ? Date.parse(endedAt) : Date.now()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '00:00:00'
  const seconds = Math.max(0, Math.floor((end - start) / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return [hours, minutes, remainder]
    .map((value) => String(value).padStart(2, '0'))
    .join(':')
}

function relativeActivity(value) {
  if (!value) return 'ยังไม่มีกิจกรรม'
  const elapsed = Math.max(0, Date.now() - Date.parse(value))
  if (!Number.isFinite(elapsed)) return 'ยังไม่มีกิจกรรม'
  if (elapsed < 10_000) return 'อัปเดตเมื่อสักครู่'
  if (elapsed < 60_000) return `อัปเดต ${Math.floor(elapsed / 1000)} วินาทีที่แล้ว`
  if (elapsed < 3_600_000) return `อัปเดต ${Math.floor(elapsed / 60_000)} นาทีที่แล้ว`
  return `อัปเดต ${new Date(value).toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
  })}`
}

function renderSessionTiming(state) {
  const summary = state.session.summary
  elements.sessionDuration.textContent = summary
    ? formatDuration(summary.startedAt, summary.endedAt)
    : '00:00:00'
  elements.lastActivity.textContent = relativeActivity(summary?.lastActivityAt)
}

function renderSession(state) {
  const session = state.session
  const summary = session.summary
  const status = session.status || 'paused'
  elements.sessionStatusChip.dataset.status = status
  elements.sessionStatusLabel.textContent = liveStatusLabels[status] || status
  elements.sessionTitle.textContent = session.active
    ? session.albumTitle || 'Live Folder Session'
    : summary
      ? `${session.albumTitle || 'Session ล่าสุด'} · จบแล้ว`
      : 'ยังไม่ได้เริ่ม Session'
  elements.sessionLocation.textContent = summary
    ? [session.folderName, session.albumTitle].filter(Boolean).join(' → ') ||
      'Session นี้พร้อมกลับมาทำงานต่อ'
    : 'เลือกอัลบั้มและโฟลเดอร์สำหรับงานนี้'
  elements.sessionDiscovered.textContent = String(summary?.discoveredCount || 0)
  elements.sessionDelivered.textContent = String(
    (summary?.completedCount || 0) + (summary?.duplicateCount || 0)
  )
  elements.sessionBytes.textContent = formatBytes(summary?.bytesCompleted || 0)
  elements.networkState.classList.toggle('offline', !session.networkOnline)
  elements.networkLabel.textContent = session.networkOnline
    ? 'ออนไลน์ · อัปเดตทันที'
    : 'ออฟไลน์ · เก็บคิวไว้แล้ว'
  renderSessionTiming(state)
}

function renderAlbums(state) {
  const selected = state.settings.albumId || ''
  elements.albumSelect.replaceChildren()
  const placeholder = document.createElement('option')
  placeholder.value = ''
  placeholder.textContent = state.albumsLoading ? 'กำลังโหลดอัลบั้ม…' : 'เลือกอัลบั้ม'
  elements.albumSelect.append(placeholder)

  for (const album of state.albums) {
    const option = document.createElement('option')
    option.value = album.id
    option.textContent = `${album.title} · ${album.photoCount} รูป`
    elements.albumSelect.append(option)
  }
  elements.albumSelect.value = selected
  elements.albumSelect.disabled = state.sync.running || state.albumsLoading
  elements.refreshAlbumsButton.disabled = state.albumsLoading
}

function queueActionButton(item) {
  const button = document.createElement('button')
  button.className = 'mini-button'
  if (item.status === 'failed' || item.status === 'cancelled') {
    button.textContent = '↻'
    button.title = 'ลองใหม่'
    button.addEventListener('click', () => action(() => bridge.retryItem(item.id), button))
    return button
  }
  if (!['completed', 'duplicate'].includes(item.status)) {
    button.textContent = '×'
    button.title = 'ยกเลิกรายการ'
    button.addEventListener('click', () => action(() => bridge.cancelItem(item.id), button))
    return button
  }
  return null
}

function renderQueue(state) {
  const summary = state.session.summary
  elements.totalCount.textContent = String(summary?.discoveredCount || 0)
  elements.activeCount.textContent = String(
    (summary?.activeCount || 0) + (summary?.queuedCount || 0)
  )
  elements.completedCount.textContent = String(
    (summary?.completedCount || 0) + (summary?.duplicateCount || 0)
  )
  elements.retryCount.textContent = String(summary?.retryCount || 0)
  elements.failedCount.textContent = String(summary?.failedCount || 0)
  elements.activityFeed.replaceChildren()

  for (const item of state.queue.slice(0, 30)) {
    const row = document.createElement('article')
    row.className = 'queue-item'

    const thumb = document.createElement('div')
    thumb.className = 'queue-thumb'
    thumb.textContent = '▧'

    const copy = document.createElement('div')
    copy.className = 'queue-copy'
    const name = document.createElement('strong')
    name.textContent = item.fileName
    const detail = document.createElement('small')
    detail.textContent = item.error?.message || `${formatBytes(item.fileSizeBytes)} · ${item.attempts ? `ลอง ${item.attempts} ครั้ง` : 'พร้อม'}`
    copy.append(name, detail)

    const status = document.createElement('div')
    status.className = 'queue-status'
    const badge = document.createElement('span')
    badge.className = `status-badge ${item.status}`
    badge.textContent = statusLabels[item.status] || item.status
    status.append(badge)
    const actionButton = queueActionButton(item)
    if (actionButton) status.append(actionButton)

    row.append(thumb, copy, status)
    elements.activityFeed.append(row)
  }

  elements.emptyState.hidden = state.queue.length > 0
  elements.activityFeed.hidden = state.queue.length === 0
}

function render(state) {
  currentState = state
  elements.releaseVersion.textContent = ` · v${state.appVersion} · ${state.releaseChannel}`
  elements.setupView.hidden = state.connected
  elements.workspace.hidden = !state.connected
  elements.connectionPill.classList.toggle('connected', state.connected)
  elements.connectionPill.classList.toggle(
    'offline',
    state.connected && !state.session.networkOnline
  )
  elements.connectionLabel.textContent = !state.connected
    ? 'ยังไม่เชื่อมต่อ'
    : state.session.networkOnline
      ? 'เชื่อมต่อแล้ว'
      : 'ออฟไลน์ · คิวปลอดภัย'

  if (!state.connected) {
    const waiting = ['starting', 'waiting'].includes(state.pairing.status)
    elements.pairIdle.hidden = waiting
    elements.pairWaiting.hidden = !waiting
    elements.connectButton.textContent =
      state.pairing.status === 'error' || state.pairing.status === 'expired'
        ? 'ลองเชื่อมต่ออีกครั้ง'
        : 'เชื่อมต่อกับ Ciiya'
    if (waiting) {
      elements.pairCode.textContent = state.pairing.userCode || 'กำลังสร้าง…'
      elements.pairExpiry.textContent = state.pairing.expiresAt
        ? `รหัสหมดอายุ ${new Date(state.pairing.expiresAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`
        : 'กำลังสร้างรหัสเชื่อมต่อ'
    }
    if (state.pairing.error) showToast(state.pairing.error)
    return
  }

  renderAlbums(state)
  elements.folderName.textContent = folderName(state.settings.folderPath)
  elements.folderPath.textContent = state.settings.folderPath || 'เลือกรูปจากโฟลเดอร์ที่ Lightroom Export ลงมา'
  elements.lightroomCard.classList.toggle('ready', state.lightroom.installed && state.lightroom.bridgeReady)
  elements.installLightroomButton.hidden = !state.lightroom.supported
  elements.installLightroomButton.textContent = state.lightroom.installed
    ? 'ติดตั้งใหม่'
    : 'ติดตั้งปลั๊กอิน'
  elements.installLightroomButton.disabled = !state.lightroom.bridgeReady
  elements.lightroomStatus.textContent = !state.lightroom.supported
    ? 'รองรับบน macOS และ Windows'
    : state.lightroom.bridgeError
      ? `Bridge ไม่พร้อม: ${state.lightroom.bridgeError}`
      : state.lightroom.installed
        ? `พร้อมใช้งาน${state.lightroom.version ? ` · v${state.lightroom.version}` : ''} — เปิด Lightroom ใหม่หากเพิ่งติดตั้ง`
        : 'ติดตั้งครั้งเดียว แล้วเลือก Ciiya Sync ในหน้าต่าง Export'
  elements.autoStart.checked = state.settings.autoStart
  elements.autoStart.disabled = state.sync.running
  elements.folderButton.disabled = state.sync.running
  elements.syncButton.textContent = state.sync.running ? 'หยุดซิงก์ชั่วคราว' : 'เริ่มซิงก์โฟลเดอร์'
  elements.syncButton.classList.toggle('running', state.sync.running)
  elements.syncHeading.textContent = state.sync.running ? 'Live Folder กำลังทำงาน' : 'พร้อมซิงก์'
  elements.syncMessage.textContent = state.sync.message
  elements.heroDot.classList.toggle('running', state.sync.running)
  elements.syncError.hidden = !state.sync.lastError
  elements.syncError.textContent = state.sync.lastError || ''
  renderSession(state)
  renderQueue(state)
}

elements.connectButton.addEventListener('click', () =>
  action(() => bridge.startPairing(), elements.connectButton)
)
elements.restartPairingButton.addEventListener('click', () =>
  action(() => bridge.startPairing(), elements.restartPairingButton)
)
elements.openPairingButton.addEventListener('click', () =>
  action(() => bridge.openPairingPage(), elements.openPairingButton)
)
elements.pairCode.addEventListener('click', async () => {
  const code = currentState?.pairing.userCode
  if (!code) return
  try {
    await navigator.clipboard.writeText(code)
    showToast('คัดลอกรหัสแล้ว')
  } catch {
    showToast(`รหัสเชื่อมต่อ: ${code}`)
  }
})
elements.albumSelect.addEventListener('change', () =>
  action(() => bridge.savePreferences({ albumId: elements.albumSelect.value || null }), elements.albumSelect)
)
elements.refreshAlbumsButton.addEventListener('click', () =>
  action(() => bridge.refreshAlbums(), elements.refreshAlbumsButton)
)
elements.folderButton.addEventListener('click', () =>
  action(() => bridge.chooseFolder(), elements.folderButton)
)
elements.installLightroomButton.addEventListener('click', () =>
  action(async () => {
    const state = await bridge.installLightroomPlugin()
    showToast('ติดตั้งปลั๊กอินแล้ว กรุณาเปิด Lightroom Classic ใหม่หนึ่งครั้ง')
    return state
  }, elements.installLightroomButton)
)
elements.autoStart.addEventListener('change', () =>
  action(() => bridge.savePreferences({ autoStart: elements.autoStart.checked }), elements.autoStart)
)
elements.syncButton.addEventListener('click', () =>
  action(
    () => currentState?.sync.running ? bridge.stopSync() : bridge.startSync(),
    elements.syncButton
  )
)
elements.disconnectButton.addEventListener('click', () => {
  if (!window.confirm('ยกเลิกการเชื่อมต่อคอมพิวเตอร์เครื่องนี้กับ Ciiya?')) return
  action(() => bridge.disconnect(), elements.disconnectButton)
})

bridge.onState(render)
action(() => bridge.getState())
setInterval(() => {
  if (currentState?.connected) renderSessionTiming(currentState)
}, 1_000)
