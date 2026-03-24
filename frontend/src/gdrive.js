// Google Drive integration — OAuth + file listing + downloading

let gisLoaded = false
function loadGIS() {
  if (gisLoaded) return Promise.resolve()
  return new Promise((resolve) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.onload = () => { gisLoaded = true; resolve() }
    document.head.appendChild(script)
  })
}

let pickerLoaded = false
function loadPicker() {
  if (pickerLoaded) return Promise.resolve()
  return new Promise((resolve) => {
    const script = document.createElement('script')
    script.src = 'https://apis.google.com/js/api.js'
    script.onload = () => {
      window.gapi.load('picker', () => { pickerLoaded = true; resolve() })
    }
    document.head.appendChild(script)
  })
}

export async function authorize(clientId, scope = 'https://www.googleapis.com/auth/drive.readonly') {
  await loadGIS()
  return new Promise((resolve, reject) => {
    /* global google */
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope,
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error))
        resolve(resp.access_token)
      },
    })
    client.requestAccessToken()
  })
}

// ── Picker-based file selection (drive.file scope) ────────
export async function pickFiles(clientId, apiKey) {
  const token = await authorize(clientId, 'https://www.googleapis.com/auth/drive.file')

  // Debug: check what scopes were actually granted
  try {
    const tokenInfo = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${token}`)
    const info = await tokenInfo.json()
    console.log('[Ocular Debug] Token scopes:', info.scope)
    console.log('[Ocular Debug] Full token info:', JSON.stringify(info))
  } catch (e) {
    console.warn('[Ocular Debug] Token check failed:', e.message)
  }

  // Debug: test direct file access
  console.log('[Ocular Debug] Token:', token.slice(0, 20) + '...')

  await loadPicker()

  return new Promise((resolve, reject) => {
    /* global google */
    const docsView = new google.picker.DocsView()
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false)
    docsView.setMimeTypes([
      'application/pdf',
      'application/vnd.google-apps.document',
      'application/vnd.google-apps.spreadsheet',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain', 'text/csv', 'text/markdown',
      'image/png', 'image/jpeg',
    ].join(','))

    // appId = project number from OAuth Client ID (before the dash)
    const appId = clientId.split('-')[0]

    const picker = new google.picker.PickerBuilder()
      .addView(docsView)
      .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setAppId(appId)
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) {
          const files = data.docs.map(doc => {
            console.log('[Ocular Debug] Raw picker doc:', JSON.stringify(doc))
            return {
              id: doc.id,
              name: doc.name,
              mimeType: doc.mimeType,
              size: doc.sizeBytes,
            }
          })
          console.log('[Ocular Debug] Files to download:', files)
          resolve({ token, files })
        } else if (data.action === google.picker.Action.CANCEL) {
          reject(new Error('popup_closed'))
        }
      })
      .build()

    picker.setVisible(true)
  })
}

// ── Full Drive listing (drive.readonly scope) ─────────────
const SUPPORTED_MIME = [
  'application/pdf',
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain', 'text/csv', 'text/markdown',
  'image/png', 'image/jpeg',
]

export async function listFiles(token) {
  const q = SUPPORTED_MIME.map(t => `mimeType='${t}'`).join(' or ')
  let allFiles = []
  let pageToken = null

  do {
    const params = new URLSearchParams({
      q: `(${q}) and trashed=false`,
      fields: 'nextPageToken,files(id,name,mimeType,size)',
      pageSize: '1000',
      orderBy: 'modifiedTime desc',
    })
    if (pageToken) params.set('pageToken', pageToken)

    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`Drive API error: ${res.status}`)
    const data = await res.json()
    allFiles = allFiles.concat(data.files || [])
    pageToken = data.nextPageToken
  } while (pageToken)

  // Skip files over 25 MB (size is undefined for Google Workspace files)
  return allFiles.filter(f => !f.size || parseInt(f.size) < 25 * 1024 * 1024)
}

// ── File downloading ──────────────────────────────────────
async function exportFile(token, fileId, mimeType) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(mimeType)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) throw new Error(`Export failed: ${res.status}`)
  return await res.text()
}

export async function downloadFile(token, file) {
  const { id, mimeType } = file

  console.log('[Ocular Debug] Downloading:', id, mimeType, file.name)

  // Google Workspace files → export as plain text
  if (mimeType === 'application/vnd.google-apps.document') {
    return { type: 'text', data: await exportFile(token, id, 'text/plain'), filetype: 'GDOC' }
  }
  if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    return { type: 'text', data: await exportFile(token, id, 'text/csv'), filetype: 'GSHEET' }
  }

  // Regular files → download binary
  const url = `https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`
  console.log('[Ocular Debug] Fetch URL:', url)
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    console.error('[Ocular Debug] Download error body:', errBody)
    throw new Error(`Download failed: ${res.status}`)
  }

  // Text files
  if (mimeType.startsWith('text/')) {
    const ext = file.name.split('.').pop()?.toUpperCase() || 'TXT'
    return { type: 'text', data: await res.text(), filetype: ext }
  }

  // Images
  if (mimeType.startsWith('image/')) {
    const blob = await res.blob()
    const dataUrl = await new Promise(r => {
      const reader = new FileReader()
      reader.onload = () => r(reader.result)
      reader.readAsDataURL(blob)
    })
    const ext = file.name.split('.').pop()?.toUpperCase() || 'IMG'
    return { type: 'image', data: dataUrl, filetype: ext }
  }

  // Binary (PDF, DOCX)
  const ext = file.name.split('.').pop()?.toUpperCase() || 'FILE'
  return { type: 'binary', data: await res.arrayBuffer(), mimeType, filetype: ext }
}
