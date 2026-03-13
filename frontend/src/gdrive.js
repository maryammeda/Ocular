// Google Drive integration — OAuth + file listing + downloading

const SCOPES = 'https://www.googleapis.com/auth/drive.readonly'

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

export async function authorize(clientId) {
  await loadGIS()
  return new Promise((resolve, reject) => {
    /* global google */
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error))
        resolve(resp.access_token)
      },
    })
    client.requestAccessToken()
  })
}

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
      pageSize: '100',
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

  // Google Workspace files → export as plain text
  if (mimeType === 'application/vnd.google-apps.document') {
    return { type: 'text', data: await exportFile(token, id, 'text/plain'), filetype: 'GDOC' }
  }
  if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    return { type: 'text', data: await exportFile(token, id, 'text/csv'), filetype: 'GSHEET' }
  }

  // Regular files → download binary
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)

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
