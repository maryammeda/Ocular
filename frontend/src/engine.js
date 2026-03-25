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
      new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href
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

// ── OCR with single worker (lazy-loaded) ─────────────────
let _ocrScheduler = null
let _ocrIdleTimer = null
async function getOcrScheduler() {
  if (_ocrIdleTimer) { clearTimeout(_ocrIdleTimer); _ocrIdleTimer = null }
  if (!_ocrScheduler) {
    const Tesseract = await import('tesseract.js')
    _ocrScheduler = Tesseract.createScheduler()
    const worker = await Tesseract.createWorker('eng')
    await worker.setParameters({
      tessedit_pageseg_mode: '6',
      tessjs_create_hocr: '0',
      tessjs_create_tsv: '0',
      tessjs_create_box: '0',
      tessjs_create_unlv: '0',
      tessjs_create_osd: '0',
    })
    _ocrScheduler.addWorker(worker)
  }
  return _ocrScheduler
}
function scheduleOcrCleanup() {
  if (_ocrIdleTimer) clearTimeout(_ocrIdleTimer)
  _ocrIdleTimer = setTimeout(async () => {
    if (_ocrScheduler) {
      await _ocrScheduler.terminate()
      _ocrScheduler = null
    }
  }, 60000)
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
  async scanDirectory(dirHandle, onProgress, { ocrEnabled = true } = {}) {
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
            const isImage = type === 'image'
            let content = ''
            let imageData = null

            if (isImage) {
              if (!ocrEnabled) continue
              if (file.size < 5 * 1024 || file.size > 5 * 1024 * 1024) continue
              imageData = await fileToDataURL(file)
              onProgress?.(count, entry.name, true)
              const scheduler = await getOcrScheduler()
              const { data } = await scheduler.addJob('recognize', file)
              content = data.text?.trim() || ''
            } else {
              content = await this._extractContent(file, type)
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
            onProgress?.(count, entry.name, false)
          } catch (e) {
            console.warn(`Skipped ${entry.name}:`, e.message)
          }
        }
      }
    }

    await walk(dirHandle, dirHandle.name)
    scheduleOcrCleanup()
    return count
  }

  // ── Quick Scan: Desktop / Downloads / Documents ──────────
  async quickScan(dirHandle, onProgress, opts = {}) {
    const targets = ['Desktop', 'Downloads', 'Documents']
    let totalCount = 0
    const scanned = []

    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'directory' && targets.includes(entry.name)) {
        const count = await this.scanDirectory(entry, onProgress, opts)
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
    const wordRe = new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi')
    const results = []

    for (const doc of this.documents) {
      const content = doc.content || ''
      const contentMatches = content.match(wordRe)
      const filenameMatches = doc.filename.match(wordRe)

      if (contentMatches || filenameMatches) {
        results.push({
          filename: doc.filename,
          filepath: doc.filepath,
          snippet: this._snippet(content, query),
          filetype: doc.filetype,
          matches: (contentMatches?.length || 0) + (filenameMatches?.length || 0),
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

  // ── Fuzzy retrieval for chat/RAG ─────────────────────────
  retrieve(query, limit = 5) {
    if (!query.trim()) return []
    const stopWords = new Set([
      'a','an','the','is','are','was','were','be','been','being','have','has','had',
      'do','does','did','will','would','could','should','can','may','might','shall',
      'about','above','after','again','all','also','am','and','any','at','because',
      'before','between','both','but','by','down','during','each','few','for','from',
      'further','get','got','he','her','here','hers','herself','him','himself','his',
      'how','i','if','in','into','it','its','itself','just','me','more','most','my',
      'myself','no','nor','not','now','of','off','on','once','only','or','other','our',
      'ours','ourselves','out','over','own','same','she','so','some','such','than',
      'that','their','theirs','them','themselves','then','there','these','they','this',
      'those','through','to','too','under','until','up','very','we','what','when',
      'where','which','while','who','whom','why','with','you','your','yours',
    ])
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w))
    if (!words.length) return []

    const escaped = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const pattern = new RegExp(`\\b(${escaped.join('|')})`, 'gi')
    const results = []

    for (const doc of this.documents) {
      const content = doc.content || ''
      const contentMatches = content.match(pattern)
      const filenameMatches = doc.filename.match(pattern)
      const score = (contentMatches?.length || 0) + (filenameMatches?.length || 0) * 3
      if (score > 0) {
        results.push({
          filename: doc.filename, filepath: doc.filepath,
          snippet: this._snippet(content, words[0]),
          filetype: doc.filetype, matches: score,
          isImage: doc.isImage, imageData: doc.imageData,
        })
      }
    }

    results.sort((a, b) => b.matches - a.matches)
    return results.slice(0, limit)
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

  // ── Public methods for external integrations ─────────────
  async addDocument({ filename, filepath, content, filetype, isImage = false, imageData = null }) {
    const doc = {
      id: filepath,
      filename,
      filepath,
      content: content || '',
      filetype,
      isImage,
      imageData,
    }
    const idx = this.documents.findIndex(d => d.id === doc.id)
    if (idx >= 0) this.documents[idx] = doc
    else this.documents.push(doc)
    await this._save(doc)
  }

  async ocrFromDataURL(dataUrl) {
    try {
      const scheduler = await getOcrScheduler()
      const { data } = await scheduler.addJob('recognize', dataUrl)
      scheduleOcrCleanup()
      return data.text?.trim() || ''
    } catch (e) {
      console.warn('OCR failed:', e.message)
      return ''
    }
  }

  async extractPDFFromBuffer(arrayBuffer) {
    const pdfjsLib = await getPdfJs()
    const data = new Uint8Array(arrayBuffer)
    const pdf = await pdfjsLib.getDocument({ data }).promise
    const pages = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const tc = await page.getTextContent()
      pages.push(tc.items.map(it => it.str).join(' '))
    }
    return pages.join('\n').trim()
  }

  async extractDOCXFromBuffer(arrayBuffer) {
    const mammoth = await getMammoth()
    const result = await mammoth.extractRawText({ arrayBuffer })
    return result.value
  }

  // ── Process dropped items (files & folders) ──────────────
  async scanDroppedItems(items, onProgress, { ocrEnabled = true } = {}) {
    let count = 0
    for (const item of items) {
      try {
        const handle = await item.getAsFileSystemHandle()
        if (!handle) continue
        if (handle.kind === 'directory') {
          count += await this.scanDirectory(handle, (c, f, isOcr) => {
            onProgress?.(count + c, f, isOcr)
          }, { ocrEnabled })
        } else {
          const dotIdx = handle.name.lastIndexOf('.')
          if (dotIdx === -1) continue
          const ext = handle.name.slice(dotIdx).toLowerCase()
          const type = SUPPORTED[ext]
          if (!type) continue

          const file = await handle.getFile()
          const isImage = type === 'image'
          let content = ''
          let imageData = null
          if (isImage) {
            if (!ocrEnabled) continue
            if (file.size < 5 * 1024 || file.size > 5 * 1024 * 1024) continue
            imageData = await fileToDataURL(file)
            onProgress?.(count, handle.name, true)
            const scheduler = await getOcrScheduler()
            const { data } = await scheduler.addJob('recognize', file)
            content = data.text?.trim() || ''
          } else {
            content = await this._extractContent(file, type)
          }

          const filepath = `dropped/${handle.name}`
          const doc = {
            id: filepath, filename: handle.name, filepath,
            content: content || '', filetype: ext.replace('.', '').toUpperCase(),
            isImage, imageData,
          }

          const idx = this.documents.findIndex(d => d.id === doc.id)
          if (idx >= 0) this.documents[idx] = doc
          else this.documents.push(doc)
          await this._save(doc)
          count++
          onProgress?.(count, handle.name, false)
        }
      } catch (e) {
        console.warn('Drop item skipped:', e.message)
      }
    }
    scheduleOcrCleanup()
    return count
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
