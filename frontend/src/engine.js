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
const MAX_CLIENT_FILE_SIZE = 50 * 1024 * 1024
const IDB_BATCH_SIZE = 25
const CONCURRENT_FILES = 6

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

// ── OCR with parallel workers (lazy-loaded) ──────────────
const OCR_WORKERS = 2
let _ocrScheduler = null
let _ocrIdleTimer = null
async function getOcrScheduler() {
  if (_ocrIdleTimer) { clearTimeout(_ocrIdleTimer); _ocrIdleTimer = null }
  if (!_ocrScheduler) {
    const Tesseract = await import('tesseract.js')
    _ocrScheduler = Tesseract.createScheduler()
    const params = {
      tessedit_pageseg_mode: '6',
      tessjs_create_hocr: '0',
      tessjs_create_tsv: '0',
      tessjs_create_box: '0',
      tessjs_create_unlv: '0',
      tessjs_create_osd: '0',
    }
    await Promise.all(Array.from({ length: OCR_WORKERS }, async () => {
      const worker = await Tesseract.createWorker('eng')
      await worker.setParameters(params)
      _ocrScheduler.addWorker(worker)
    }))
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
  _docMap = new Map()  // id -> index for O(1) lookups
  _db = null

  async init() {
    this._db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2) // bumped version for lastModified field
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
    const allDocs = await new Promise((resolve, reject) => {
      const req = store.getAll()
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    this.documents = allDocs.map(doc => {
      if (doc.imageData) {
        const { imageData, ...rest } = doc
        return rest
      }
      return doc
    })
    this._rebuildMap()
  }

  _rebuildMap() {
    this._docMap.clear()
    for (let i = 0; i < this.documents.length; i++) {
      this._docMap.set(this.documents[i].id, i)
    }
  }

  _upsertMem(doc) {
    const memDoc = doc.imageData ? { ...doc, imageData: null } : doc
    const idx = this._docMap.get(memDoc.id)
    if (idx !== undefined) {
      this.documents[idx] = memDoc
    } else {
      this._docMap.set(memDoc.id, this.documents.length)
      this.documents.push(memDoc)
    }
  }

  // Check if a file is already indexed with the same mtime (skip unchanged)
  _isUnchanged(filepath, lastModified) {
    const idx = this._docMap.get(filepath)
    if (idx === undefined) return false
    return this.documents[idx].lastModified === lastModified
  }

  async getImageData(filepath) {
    const tx = this._db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    return new Promise((resolve, reject) => {
      const req = store.get(filepath)
      req.onsuccess = () => resolve(req.result?.imageData || null)
      req.onerror = () => reject(req.error)
    })
  }

  // ── Batched IndexedDB writes ─────────────────────────────
  _writeBatch = []
  _batchPromise = null

  _queueWrite(doc) {
    this._writeBatch.push(doc)
    if (this._writeBatch.length >= IDB_BATCH_SIZE) {
      return this._flushBatch()
    }
    return Promise.resolve()
  }

  _flushBatch() {
    if (this._writeBatch.length === 0) return Promise.resolve()
    const batch = this._writeBatch.splice(0)
    const chain = (this._batchPromise || Promise.resolve()).then(() =>
      new Promise((resolve, reject) => {
        try {
          const tx = this._db.transaction(STORE_NAME, 'readwrite')
          const store = tx.objectStore(STORE_NAME)
          for (const doc of batch) store.put(doc)
          tx.oncomplete = resolve
          tx.onerror = () => reject(tx.error || new Error('IDB batch write error'))
          tx.onabort = () => reject(new Error('IDB transaction aborted'))
        } catch (e) { reject(e) }
      })
    ).catch(e => console.error('IDB batch write failed:', e))
    this._batchPromise = chain
    return chain
  }

  async _flushAll() {
    await this._flushBatch()
    await this._batchPromise
  }

  // ── Scan a single directory (fully streaming, non-blocking) ──
  // Processes files AS they are discovered — no collect-then-process.
  // Returns { textCount, imageCount, ocrPromise, skippedCount }
  // onProgress(indexed, filename) fires after each file is searchable.
  // onOcrProgress(done, total, filename) fires as background OCR progresses.
  async scanDirectory(dirHandle, onProgress, { ocrEnabled = true, onOcrProgress } = {}) {
    let textCount = 0
    let skippedCount = 0
    const imageQueue = []

    // Buffer for concurrent text processing
    let textBuffer = []

    const flushTextBuffer = async () => {
      if (textBuffer.length === 0) return
      const batch = textBuffer.splice(0)
      const results = await Promise.allSettled(
        batch.map(async ({ entry, ext, type, pathPrefix }) => {
          const file = await entry.getFile()
          if (file.size > MAX_CLIENT_FILE_SIZE) return null
          const filepath = `${pathPrefix}/${entry.name}`
          // Skip unchanged files
          if (this._isUnchanged(filepath, file.lastModified)) return 'unchanged'
          const content = await this._extractContent(file, type)
          return {
            id: filepath, filename: entry.name, filepath,
            content: content || '', filetype: ext.replace('.', '').toUpperCase(),
            isImage: false, imageData: null, lastModified: file.lastModified,
          }
        })
      )
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value === 'unchanged') {
          skippedCount++
        } else if (r.status === 'fulfilled' && r.value) {
          await this._queueWrite(r.value)
          this._upsertMem(r.value)
          textCount++
          onProgress?.(textCount, r.value.filename)
        }
      }
    }

    // Walk and process simultaneously — files are processed as discovered
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

          if (type === 'image') {
            if (ocrEnabled) imageQueue.push({ entry, ext, pathPrefix })
          } else {
            textBuffer.push({ entry, ext, type, pathPrefix })
            // Flush when buffer is full — processes concurrently while walk continues
            if (textBuffer.length >= CONCURRENT_FILES) {
              await flushTextBuffer()
            }
          }
        }
      }
    }

    await walk(dirHandle, dirHandle.name)
    await flushTextBuffer()  // Process any remaining text files
    await this._flushAll()

    // Background OCR — doesn't block
    const ocrPromise = imageQueue.length > 0
      ? this._processImagesBackground(imageQueue, onOcrProgress)
      : Promise.resolve(0)

    return { textCount, imageCount: imageQueue.length, skippedCount, ocrPromise }
  }

  async _processImagesBackground(imageFiles, onOcrProgress) {
    let done = 0
    const total = imageFiles.length

    for (const { entry, ext, pathPrefix } of imageFiles) {
      try {
        const file = await entry.getFile()
        if (file.size > MAX_CLIENT_FILE_SIZE) { done++; continue }
        if (file.size < 5 * 1024 || file.size > 5 * 1024 * 1024) { done++; continue }

        const filepath = `${pathPrefix}/${entry.name}`
        // Skip unchanged images too
        if (this._isUnchanged(filepath, file.lastModified)) { done++; onOcrProgress?.(done, total, entry.name); continue }

        const imageData = await fileToDataURL(file)
        const scheduler = await getOcrScheduler()
        const { data } = await scheduler.addJob('recognize', file)
        const content = data.text?.trim() || ''
        const doc = {
          id: filepath, filename: entry.name, filepath,
          content, filetype: ext.replace('.', '').toUpperCase(),
          isImage: true, imageData, lastModified: file.lastModified,
        }
        await this._queueWrite(doc)
        this._upsertMem(doc)
        done++
        onOcrProgress?.(done, total, entry.name)
      } catch (e) {
        done++
        console.warn(`Skipped ${entry.name}:`, e.message)
      }
    }

    await this._flushAll()
    scheduleOcrCleanup()
    return done
  }

  // ── Quick Scan: Desktop / Downloads / Documents ──────────
  async quickScan(dirHandle, onProgress, opts = {}) {
    const targets = ['Desktop', 'Downloads', 'Documents']
    let totalCount = 0
    const scanned = []

    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'directory' && targets.includes(entry.name)) {
        const { textCount } = await this.scanDirectory(entry, onProgress, opts)
        totalCount += textCount
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
    const maxPages = Math.min(pdf.numPages, 50)
    for (let i = 1; i <= maxPages; i++) {
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
  retrieve(query, limit = 10) {
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
      'tell','find','show','give','look','know','want','need','think','say','said',
      'make','like','take','come','see','go','ask','use','try','help','let','keep',
      'put','call','run','move','play','pay','hear','seem','feel','leave','bring',
      'talk','turn','start','open','close','read','write','set','learn','change',
      'follow','stop','hold','sit','stand','lose','happen','include','file','document',
      'pdf','image','screenshot','folder','doc','docs','files','documents','png','jpg',
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
    const idx = this._docMap.get(filepath)
    return idx !== undefined ? this.documents[idx] : null
  }

  get count() {
    return this.documents.length
  }

  async syncCount() {
    await this._flushAll()
    await this._loadAll()
    return this.documents.length
  }

  async clearAll() {
    this.documents = []
    this._docMap.clear()
    const tx = this._db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).clear()
    await new Promise(r => { tx.oncomplete = r })
  }

  // ── Public methods for external integrations ─────────────
  async addDocument({ filename, filepath, content, filetype, isImage = false, imageData = null, driveMtime = null }) {
    const doc = {
      id: filepath, filename, filepath,
      content: content || '', filetype,
      isImage, imageData, driveMtime,
    }
    await this._queueWrite(doc)
    this._upsertMem(doc)
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
  async scanDroppedItems(items, onProgress, { ocrEnabled = true, onOcrProgress } = {}) {
    let count = 0

    for (const item of items) {
      try {
        const handle = await item.getAsFileSystemHandle()
        if (!handle) continue
        if (handle.kind === 'directory') {
          const { textCount, ocrPromise } = await this.scanDirectory(handle, (c, f) => {
            onProgress?.(count + c, f)
          }, { ocrEnabled, onOcrProgress })
          count += textCount
          // For drops, wait for OCR too since it's usually a small selection
          await ocrPromise
        } else {
          const dotIdx = handle.name.lastIndexOf('.')
          if (dotIdx === -1) continue
          const ext = handle.name.slice(dotIdx).toLowerCase()
          const type = SUPPORTED[ext]
          if (!type) continue

          const file = await handle.getFile()
          if (file.size > MAX_CLIENT_FILE_SIZE) continue

          if (type === 'image') {
            if (!ocrEnabled) continue
            if (file.size < 5 * 1024 || file.size > 5 * 1024 * 1024) continue
            const imageData = await fileToDataURL(file)
            const scheduler = await getOcrScheduler()
            const { data } = await scheduler.addJob('recognize', file)
            const content = data.text?.trim() || ''
            const filepath = `dropped/${handle.name}`
            const doc = {
              id: filepath, filename: handle.name, filepath,
              content, filetype: ext.replace('.', '').toUpperCase(),
              isImage: true, imageData, lastModified: file.lastModified,
            }
            await this._queueWrite(doc)
            this._upsertMem(doc)
          } else {
            const content = await this._extractContent(file, type)
            const filepath = `dropped/${handle.name}`
            const doc = {
              id: filepath, filename: handle.name, filepath,
              content: content || '', filetype: ext.replace('.', '').toUpperCase(),
              isImage: false, imageData: null, lastModified: file.lastModified,
            }
            await this._queueWrite(doc)
            this._upsertMem(doc)
          }
          count++
          onProgress?.(count, handle.name)
        }
      } catch (e) {
        console.warn('Drop item skipped:', e.message)
      }
    }
    await this._flushAll()
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
