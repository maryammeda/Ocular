// Client-side search engine using File System Access API + IndexedDB persistence

const SUPPORTED = {
  '.txt': 'text', '.md': 'text', '.csv': 'text',
  '.pdf': 'pdf', '.docx': 'docx',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image',
}

const IGNORED_DIRS = new Set([
  '.git', '.vscode', '.idea', 'node_modules', 'venv', '__pycache__',
  'AppData', '$Recycle.Bin', '.Trash', 'Library', '.cache',
])

const DB_NAME = 'ocular_index'
const STORE_NAME = 'documents'

// ── PDF extraction (lazy-loaded) ──────────────────────────
let _pdfjsLib = null
async function getPdfJs() {
  if (!_pdfjsLib) {
    _pdfjsLib = await import('pdfjs-dist')
    _pdfjsLib.GlobalWorkerOptions.workerSrc =
      `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${_pdfjsLib.version}/pdf.worker.min.mjs`
  }
  return _pdfjsLib
}

// ── DOCX extraction (lazy-loaded) ─────────────────────────
let _mammoth = null
async function getMammoth() {
  if (!_mammoth) {
    _mammoth = (await import('mammoth')).default || (await import('mammoth'))
  }
  return _mammoth
}

// ── Engine ────────────────────────────────────────────────
class SearchEngine {
  documents = []
  _db = null

  async init() {
    this._db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = (e) => {
        const db = e.target.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    await this._loadAll()
  }

  async _loadAll() {
    const tx = this._db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    this.documents = await new Promise((resolve, reject) => {
      const req = store.getAll()
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  async _save(doc) {
    const tx = this._db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(doc)
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
  }

  // ── Scan a single directory ──────────────────────────────
  async scanDirectory(dirHandle, onProgress) {
    let count = 0

    const walk = async (handle, pathPrefix) => {
      for await (const entry of handle.values()) {
        if (entry.kind === 'directory') {
          if (IGNORED_DIRS.has(entry.name)) continue
          await walk(entry, `${pathPrefix}/${entry.name}`)
        } else {
          const dotIdx = entry.name.lastIndexOf('.')
          if (dotIdx === -1) continue
          const ext = entry.name.slice(dotIdx).toLowerCase()
          const type = SUPPORTED[ext]
          if (!type) continue

          try {
            const file = await entry.getFile()
            const content = type !== 'image' ? await this._extractContent(file, type) : ''
            const isImage = type === 'image'

            let imageData = null
            if (isImage && file.size < 10 * 1024 * 1024) {
              imageData = await fileToDataURL(file)
            }

            const filepath = `${pathPrefix}/${entry.name}`
            const doc = {
              id: filepath,
              filename: entry.name,
              filepath,
              content: content || '',
              filetype: ext.replace('.', '').toUpperCase(),
              isImage,
              imageData,
            }

            const idx = this.documents.findIndex(d => d.id === doc.id)
            if (idx >= 0) this.documents[idx] = doc
            else this.documents.push(doc)

            await this._save(doc)
            count++
            onProgress?.(count, entry.name)
          } catch (e) {
            console.warn(`Skipped ${entry.name}:`, e.message)
          }
        }
      }
    }

    await walk(dirHandle, dirHandle.name)
    return count
  }

  // ── Quick Scan: Desktop / Downloads / Documents ──────────
  async quickScan(dirHandle, onProgress) {
    const targets = ['Desktop', 'Downloads', 'Documents']
    let totalCount = 0
    const scanned = []

    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'directory' && targets.includes(entry.name)) {
        const count = await this.scanDirectory(entry, onProgress)
        totalCount += count
        scanned.push(entry.name)
      }
    }

    return { totalCount, scanned }
  }

  // ── Text extraction ──────────────────────────────────────
  async _extractContent(file, type) {
    if (type === 'text') return await file.text()
    if (type === 'pdf') return await this._extractPDF(file)
    if (type === 'docx') return await this._extractDOCX(file)
    return ''
  }

  async _extractPDF(file) {
    const pdfjsLib = await getPdfJs()
    const data = new Uint8Array(await file.arrayBuffer())
    const pdf = await pdfjsLib.getDocument({ data }).promise
    const pages = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const tc = await page.getTextContent()
      pages.push(tc.items.map(it => it.str).join(' '))
    }
    return pages.join('\n').trim()
  }

  async _extractDOCX(file) {
    const mammoth = await getMammoth()
    const arrayBuffer = await file.arrayBuffer()
    const result = await mammoth.extractRawText({ arrayBuffer })
    return result.value
  }

  // ── Search ───────────────────────────────────────────────
  search(query) {
    if (!query.trim()) return []
    const q = query.toLowerCase()
    const results = []

    for (const doc of this.documents) {
      const contentLower = (doc.content || '').toLowerCase()
      const filenameLower = doc.filename.toLowerCase()

      if (contentLower.includes(q) || filenameLower.includes(q)) {
        const count = contentLower.split(q).length - 1
        results.push({
          filename: doc.filename,
          filepath: doc.filepath,
          snippet: this._snippet(doc.content, query),
          filetype: doc.filetype,
          matches: Math.max(count, 1),
          isImage: doc.isImage,
          imageData: doc.imageData,
        })
      }
    }

    results.sort((a, b) => b.matches - a.matches)
    return results
  }

  _snippet(content, query) {
    if (!content) return ''
    const idx = content.toLowerCase().indexOf(query.toLowerCase())
    if (idx === -1) return content.slice(0, 200)

    const start = Math.max(0, idx - 80)
    const end = Math.min(content.length, idx + query.length + 80)
    let s = content.slice(start, end)
    if (start > 0) s = '...' + s
    if (end < content.length) s += '...'

    const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return s.replace(new RegExp(esc, 'gi'), '<b>$&</b>')
  }

  // ── Preview ──────────────────────────────────────────────
  getDocument(filepath) {
    return this.documents.find(d => d.id === filepath) || null
  }

  get count() {
    return this.documents.length
  }

  async clearAll() {
    this.documents = []
    const tx = this._db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).clear()
    await new Promise(r => { tx.oncomplete = r })
  }
}

function fileToDataURL(file) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.readAsDataURL(file)
  })
}

export const engine = new SearchEngine()
