import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, FolderSearch, Upload, Loader2, FileText, FileCode, FileImage, File, CheckCircle2, AlertCircle, X, Orbit, Scan, Clock, Trash2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { engine } from './engine'
import { authorize, listFiles, downloadFile } from './gdrive'

const GOOGLE_CLIENT_ID = '626244387316-qmi5r37ur3ibi73v1ngj7ej34db8spbn.apps.googleusercontent.com'

const fileIconMap = {
  py: FileCode, js: FileCode, jsx: FileCode, ts: FileCode, tsx: FileCode,
  html: FileCode, css: FileCode, json: FileCode, sql: FileCode, sh: FileCode,
  md: FileText, txt: FileText, pdf: FileText, docx: FileText, doc: FileText, csv: FileText,
  png: FileImage, jpg: FileImage, jpeg: FileImage, gif: FileImage, svg: FileImage, webp: FileImage,
}
function getFileIcon(filename, size = 18) {
  const Icon = fileIconMap[filename.split('.').pop().toLowerCase()] || File
  return <Icon size={size} />
}

const supportsFS = typeof window !== 'undefined' && 'showDirectoryPicker' in window

// ── History ────────────────────────────────────────────────
const HK = 'ocular_search_history'
function getHistory() { try { return JSON.parse(localStorage.getItem(HK)) || [] } catch { return [] } }
function addToHistory(q) {
  const t = q.trim(); if (!t) return
  const h = getHistory().filter(x => x.toLowerCase() !== t.toLowerCase()); h.unshift(t)
  localStorage.setItem(HK, JSON.stringify(h.slice(0, 10)))
}
function removeFromHistory(q) { localStorage.setItem(HK, JSON.stringify(getHistory().filter(x => x !== q))) }
function clearHistory() { localStorage.removeItem(HK) }

// ── Toast ──────────────────────────────────────────────────
function Toast({ message, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t) }, [onClose])
  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
      className="fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl bg-white/10 backdrop-blur-2xl border border-white/15 shadow-[0_8px_40px_rgba(0,0,0,0.3),0_0_30px_rgba(255,255,255,0.05)]"
    >
      {type === 'success' ? <CheckCircle2 size={16} className="text-white" /> : <AlertCircle size={16} className="text-white/50" />}
      <span className="text-sm text-white/90">{message}</span>
      <button onClick={onClose} className="ml-1 text-white/30 hover:text-white transition"><X size={14} /></button>
    </motion.div>
  )
}

// ── Scan Overlay ───────────────────────────────────────────
function ScanOverlay({ label, fileCount, currentFile, isOcr }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-40 bg-black/70 backdrop-blur-xl flex items-center justify-center">
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
        className="relative bg-white/10 backdrop-blur-2xl border border-white/15 rounded-3xl p-12 flex flex-col items-center gap-6 shadow-[0_20px_80px_rgba(0,0,0,0.4),0_0_100px_rgba(255,255,255,0.05)]">
        <div className="absolute -inset-4 rounded-[2rem] bg-white/[0.04] blur-3xl pointer-events-none" />
        <div className="relative flex items-center justify-center">
          <motion.div className="absolute w-20 h-20 rounded-full border border-white/25"
            animate={{ scale: [1, 1.8, 1], opacity: [0.4, 0, 0.4] }}
            transition={{ duration: 2, repeat: Infinity }} />
          <motion.div className="absolute w-16 h-16 rounded-full border border-white/15"
            animate={{ scale: [1, 1.5, 1], opacity: [0.3, 0, 0.3] }}
            transition={{ duration: 2, repeat: Infinity, delay: 0.5 }} />
          <Scan className="text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.4)]" size={24} />
        </div>
        <div className="text-center">
          <p className="text-white font-medium text-lg">{label}</p>
          <motion.p className="text-white/40 text-sm mt-1.5"
            animate={{ opacity: [0.3, 0.7, 0.3] }} transition={{ duration: 2, repeat: Infinity }}>
            {isOcr ? 'Running OCR — images take longer to process' : 'Crawling and indexing files...'}
          </motion.p>
          {fileCount > 0 && (
            <p className="text-white/25 text-xs mt-3 font-mono">{fileCount} files indexed</p>
          )}
          {currentFile && (
            <p className="text-white/15 text-[10px] mt-1 font-mono truncate max-w-[280px]">{currentFile}</p>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── Result Card ────────────────────────────────────────────
function ResultCard({ item, index, searchQuery }) {
  const [hovered, setHovered] = useState(false)
  const timer = useRef(null)
  const doc = useRef(null)

  const onEnter = () => {
    timer.current = setTimeout(() => {
      setHovered(true)
      if (!doc.current) doc.current = engine.getDocument(item.filepath)
    }, 400)
  }
  const onLeave = () => { clearTimeout(timer.current); setHovered(false) }

  const hl = (text) => {
    if (!text || !searchQuery) return text
    const t = text.length > 800 ? text.slice(0, 800) + '...' : text
    const parts = t.split(new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
    return parts.map((p, i) => p.toLowerCase() === searchQuery.toLowerCase()
      ? <mark key={i} className="bg-white/20 text-white rounded-sm px-0.5">{p}</mark> : p)
  }

  const preview = doc.current

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.4 }}
      onMouseEnter={onEnter} onMouseLeave={onLeave}
      className="group relative rounded-2xl p-5 bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] hover:border-white/[0.2] hover:shadow-[0_4px_40px_rgba(255,255,255,0.06),0_0_80px_rgba(255,255,255,0.02)] backdrop-blur-sm transition-all duration-400 cursor-default"
    >
      {/* Top shine */}
      <div className="absolute top-0 left-[10%] right-[10%] h-[1px] bg-gradient-to-r from-transparent via-white/15 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      {/* Card glow */}
      <div className="absolute -inset-1 rounded-2xl bg-white/[0.03] opacity-0 group-hover:opacity-100 blur-xl transition-opacity duration-500 pointer-events-none" />

      <div className="flex items-start gap-3.5">
        <div className="mt-0.5 text-white/25 group-hover:text-white/60 transition-colors duration-300">
          {getFileIcon(item.filename)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 mb-1.5">
            <h3 className="font-medium text-white/80 group-hover:text-white truncate transition-colors">
              {item.filename}
            </h3>
            {item.filetype && (
              <span className="text-[10px] uppercase tracking-widest text-white/30 bg-white/[0.06] px-2.5 py-0.5 rounded-full font-mono shrink-0 border border-white/[0.06]">
                {item.filetype}
              </span>
            )}
            {item.matches > 1 && (
              <span className="text-[10px] text-white/35 bg-white/[0.06] px-2.5 py-0.5 rounded-full font-mono shrink-0 border border-white/[0.06]">
                {item.matches} mentions
              </span>
            )}
          </div>
          <p className="text-[11px] text-white/20 mb-2 truncate font-mono">{item.filepath}</p>
          <p className="text-[13px] text-white/40 leading-relaxed [&>b]:text-white/90 [&>b]:font-medium"
            dangerouslySetInnerHTML={{ __html: item.snippet }} />

          <AnimatePresence>
            {hovered && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3 }} className="overflow-hidden">
                <div className="mt-3 pt-3 border-t border-white/[0.06]">
                  {preview?.isImage && preview.imageData && (
                    <div className="space-y-3">
                      <img src={preview.imageData} alt={preview.filename}
                        className="max-h-48 rounded-xl border border-white/10 object-contain" />
                      {preview.content && <p className="text-xs text-white/30 leading-relaxed">{hl(preview.content)}</p>}
                    </div>
                  )}
                  {preview && !preview.isImage && preview.content && (
                    <div className="bg-white/[0.03] rounded-xl p-4 max-h-48 overflow-y-auto border border-white/[0.05]">
                      <p className="text-xs text-white/35 leading-relaxed whitespace-pre-wrap font-mono">{hl(preview.content)}</p>
                    </div>
                  )}
                  {preview && !preview.content && !preview.isImage && (
                    <p className="text-xs text-white/20 py-2">No preview available</p>
                  )}
                  {preview?.content && (
                    <p className="text-[10px] text-white/15 mt-2 font-mono">{preview.content.length.toLocaleString()} characters</p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  )
}

// ── Rotating Tips ─────────────────────────────────────────
const TIPS = [
  'Search inside PDFs, DOCX, and Google Docs — not just filenames',
  'Hover over a result to preview its full content',
  'Connect Google Drive to search across all your cloud documents',
  'Your indexed files persist between sessions — no need to re-scan',
  'Use specific keywords for better results — Ocular ranks by match count',
  'Index any folder on your computer using the "Index folder" button',
  'Google Docs and Sheets are automatically converted to searchable text',
  'Results are sorted by how many times your keyword appears in the file',
]

function RotatingTips() {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * TIPS.length))
  useEffect(() => {
    const timer = setInterval(() => setIndex(i => (i + 1) % TIPS.length), 5000)
    return () => clearInterval(timer)
  }, [])
  return (
    <div className="h-6 relative overflow-hidden">
      <AnimatePresence mode="wait">
        <motion.p
          key={index}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.3 }}
          className="text-white/20 text-xs font-mono absolute inset-x-0"
        >
          tip: {TIPS[index]}
        </motion.p>
      </AnimatePresence>
    </div>
  )
}

// ── App ────────────────────────────────────────────────────
function App() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanLabel, setScanLabel] = useState('')
  const [scanCount, setScanCount] = useState(0)
  const [scanFile, setScanFile] = useState('')
  const [toast, setToast] = useState(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [history, setHistory] = useState(getHistory())
  const [showHistory, setShowHistory] = useState(false)
  const [indexedCount, setIndexedCount] = useState(0)
  const [ready, setReady] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [ocrEnabled, setOcrEnabled] = useState(() => localStorage.getItem('ocular_ocr_enabled') !== 'false')
  const [isOcr, setIsOcr] = useState(false)
  const inputRef = useRef(null)
  const historyRef = useRef(null)
  const dragCounter = useRef(0)

  const notify = (msg, type = 'success') => setToast({ message: msg, type })

  // Init engine
  useEffect(() => {
    engine.init().then(() => {
      setIndexedCount(engine.count)
      setReady(true)
    }).catch(() => setReady(true))
  }, [])

  useEffect(() => { if (ready) inputRef.current?.focus() }, [ready])
  useEffect(() => {
    const h = (e) => { if (historyRef.current && !historyRef.current.contains(e.target)) setShowHistory(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])

  const onProgress = useCallback((count, filename, ocrActive) => {
    setScanCount(count)
    setScanFile(filename)
    if (ocrActive !== undefined) setIsOcr(ocrActive)
  }, [])

  const runSearch = (sq) => {
    if (!sq.trim()) return; setQuery(sq); setSearching(true); setHasSearched(true); setShowHistory(false)
    addToHistory(sq); setHistory(getHistory())
    const r = engine.search(sq)
    setResults(r)
    if (!r.length) notify('No matches found.', 'error')
    setSearching(false)
  }
  const handleSearch = (e) => { e.preventDefault(); runSearch(query) }
  const handleRemoveHistory = (e, q) => { e.stopPropagation(); removeFromHistory(q); setHistory(getHistory()) }
  const handleClearHistory = (e) => { e.stopPropagation(); clearHistory(); setHistory([]) }
  const filteredHistory = query.trim()
    ? history.filter(h => h.toLowerCase().includes(query.toLowerCase()) && h.toLowerCase() !== query.toLowerCase()) : history

  // ── Index folder (pick any folder) ───────────────────────
  const handleScan = async () => {
    if (!supportsFS) return notify('Please use Chrome or Edge to scan folders.', 'error')
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'read' })
      setScanning(true); setScanCount(0); setScanFile(''); setIsOcr(false); setScanLabel(`Scanning ${dirHandle.name}`)
      const count = await engine.scanDirectory(dirHandle, onProgress, { ocrEnabled })
      setIndexedCount(engine.count)
      notify(`Done — ${count} files indexed from ${dirHandle.name}`)
    } catch (e) {
      if (e.name !== 'AbortError') notify(e.message, 'error')
    } finally { setScanning(false) }
  }

  // ── Google Drive ─────────────────────────────────────────
  const handleGoogleDrive = async () => {
    if (!GOOGLE_CLIENT_ID) return notify('Google Drive not configured.', 'error')
    try {
      const token = await authorize(GOOGLE_CLIENT_ID)
      setScanning(true); setScanCount(0); setScanFile(''); setIsOcr(false); setScanLabel('Fetching files from Google Drive')

      const files = await listFiles(token)
      setScanLabel(`Indexing ${files.length} files from Google Drive`)

      let count = 0
      let skipped = 0
      const BATCH_SIZE = 5

      const processFile = async (file) => {
        const result = await downloadFile(token, file)
        let content = ''
        let isImage = false
        let imageData = null

        if (result.type === 'text') {
          content = result.data
        } else if (result.type === 'image') {
          isImage = true
          imageData = result.data
          content = ocrEnabled ? await engine.ocrFromDataURL(result.data) : ''
        } else if (result.type === 'binary') {
          if (result.mimeType === 'application/pdf') {
            content = await engine.extractPDFFromBuffer(result.data)
          } else {
            content = await engine.extractDOCXFromBuffer(result.data)
          }
        }

        console.log(`[GDrive] ${file.name} | type=${result.type} | content=${content.length} chars`)

        await engine.addDocument({
          filename: file.name,
          filepath: `Google Drive/${file.name}`,
          content,
          filetype: result.filetype,
          isImage,
          imageData,
        })
      }

      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE)
        const results = await Promise.allSettled(batch.map(f => processFile(f)))
        for (let j = 0; j < results.length; j++) {
          if (results[j].status === 'fulfilled') {
            count++
          } else {
            skipped++
            console.warn(`Skipped ${batch[j].name}:`, results[j].reason?.message)
          }
        }
        onProgress(count, batch[batch.length - 1].name)
      }

      setIndexedCount(engine.count)
      const msg = skipped > 0
        ? `Indexed ${count} files from Google Drive (${skipped} skipped)`
        : `Indexed ${count} files from Google Drive`
      notify(msg)
    } catch (e) {
      if (!e.message?.includes('popup_closed')) notify(e.message, 'error')
    } finally { setScanning(false) }
  }

  // ── Drag & drop ──────────────────────────────────────────
  const handleDragEnter = (e) => {
    e.preventDefault(); dragCounter.current++; setDragging(true)
  }
  const handleDragLeave = (e) => {
    e.preventDefault(); dragCounter.current--; if (dragCounter.current === 0) setDragging(false)
  }
  const handleDragOver = (e) => { e.preventDefault() }
  const handleDrop = async (e) => {
    e.preventDefault(); dragCounter.current = 0; setDragging(false)
    const items = [...e.dataTransfer.items]
    if (!items.length) return
    setScanning(true); setScanCount(0); setScanFile(''); setIsOcr(false); setScanLabel('Scanning dropped files')
    try {
      const count = await engine.scanDroppedItems(items, onProgress, { ocrEnabled })
      setIndexedCount(engine.count)
      notify(`Done — ${count} files indexed`)
    } catch (err) {
      notify(err.message, 'error')
    } finally { setScanning(false) }
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <Loader2 className="text-white/30 animate-spin" size={24} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-white/20 relative overflow-x-hidden"
      onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}>

      {/* Drop overlay */}
      <AnimatePresence>
        {dragging && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-2xl flex items-center justify-center pointer-events-none">
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              className="flex flex-col items-center gap-5">
              <div className="relative">
                <motion.div className="w-32 h-32 rounded-3xl border-2 border-dashed border-white/30 flex items-center justify-center"
                  animate={{ borderColor: ['rgba(255,255,255,0.2)', 'rgba(255,255,255,0.5)', 'rgba(255,255,255,0.2)'] }}
                  transition={{ duration: 2, repeat: Infinity }}>
                  <Upload className="text-white/60" size={36} />
                </motion.div>
                <div className="absolute -inset-8 bg-white/5 rounded-full blur-3xl" />
              </div>
              <div className="text-center">
                <p className="text-white/80 text-lg font-medium">Drop to scan</p>
                <p className="text-white/30 text-sm mt-1">Files and folders will be indexed</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top edge glow */}
      <div className="fixed top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent z-30" />

      <AnimatePresence>{toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}</AnimatePresence>
      <AnimatePresence>{scanning && <ScanOverlay label={scanLabel} fileCount={scanCount} currentFile={scanFile} isOcr={isOcr} />}</AnimatePresence>

      <div className="relative z-10 max-w-2xl mx-auto px-6 pt-16 pb-16">

        {/* Header */}
        <motion.header initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }} className="text-center mb-8">
          <div className="inline-flex items-center gap-3.5 mb-4">
            <div className="relative">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}>
                <Orbit className="text-white" size={30} strokeWidth={1.5} />
              </motion.div>
              <div className="absolute -inset-4 bg-white/15 rounded-full blur-2xl" />
              <div className="absolute -inset-8 bg-white/5 rounded-full blur-3xl" />
            </div>
            <h1 className="text-4xl font-semibold tracking-tight">
              <span className="drop-shadow-[0_0_20px_rgba(255,255,255,0.5)] drop-shadow-[0_0_60px_rgba(255,255,255,0.25)]">Ocular</span>
            </h1>
          </div>
          <p className="text-white/30 text-[13px] tracking-[0.2em] uppercase font-light">
            Search your files instantly
          </p>
          {indexedCount > 0 && (
            <p className="text-white/15 text-[11px] mt-2 font-mono">{indexedCount} files in index</p>
          )}
        </motion.header>

        {/* Search */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }} className="relative mb-6" ref={historyRef}>
          <form onSubmit={handleSearch} className="relative group/s">
            {/* Focus glow */}
            <div className="absolute -inset-3 rounded-3xl bg-white/[0.06] opacity-0 group-focus-within/s:opacity-100 blur-2xl transition-opacity duration-700 pointer-events-none" />
            <div className="absolute -inset-6 rounded-[2rem] bg-white/[0.03] opacity-0 group-focus-within/s:opacity-100 blur-3xl transition-opacity duration-700 pointer-events-none" />
            <div className="relative">
              <input ref={inputRef} type="text" value={query}
                onChange={(e) => setQuery(e.target.value)} onClick={() => setShowHistory(true)}
                placeholder="Search files, content, anything..."
                className="w-full bg-white/[0.06] backdrop-blur-xl border border-white/[0.1] rounded-2xl py-4 px-6 pl-[3.25rem] pr-12 text-[15px] text-white placeholder-white/25 focus:outline-none focus:border-white/[0.25] focus:bg-white/[0.08] transition-all duration-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_0_15px_rgba(255,255,255,0.03)] focus:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_30px_rgba(255,255,255,0.07),0_0_60px_rgba(255,255,255,0.03)]" />
              {searching
                ? <Loader2 className="absolute left-[1.1rem] top-[1.05rem] text-white animate-spin" size={20} />
                : <Search className="absolute left-[1.1rem] top-[1.05rem] text-white/30" size={20} />}
              {query ? (
                <button type="button"
                  onClick={() => { setQuery(''); setResults([]); setHasSearched(false); inputRef.current?.focus() }}
                  className="absolute right-4 top-[1.05rem] text-white/25 hover:text-white/70 transition">
                  <X size={18} />
                </button>
              ) : (
                <div className="absolute right-5 top-[1.15rem] text-[10px] text-white/15 font-mono tracking-[0.15em] hidden sm:block">ENTER</div>
              )}
              {/* Top shine on search bar */}
              <div className="absolute top-0 left-[10%] right-[10%] h-[1px] bg-gradient-to-r from-transparent via-white/[0.15] to-transparent rounded-full" />
              {/* Bottom shine on focus */}
              <div className="absolute bottom-0 left-[20%] right-[20%] h-[1px] bg-gradient-to-r from-transparent via-white/[0.06] to-transparent rounded-full opacity-0 group-focus-within/s:opacity-100 transition-opacity duration-500" />
            </div>
          </form>

          {/* History */}
          <AnimatePresence>
            {showHistory && filteredHistory.length > 0 && (
              <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }}
                className="absolute top-full left-0 right-0 mt-2 bg-white/[0.07] backdrop-blur-2xl border border-white/[0.1] rounded-2xl overflow-hidden shadow-[0_16px_60px_rgba(0,0,0,0.4)] z-20">
                <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
                  <span className="text-[10px] text-white/25 font-mono tracking-[0.15em] flex items-center gap-2">
                    <Clock size={10} /> RECENT
                  </span>
                  <button onClick={handleClearHistory}
                    className="text-[10px] text-white/20 hover:text-white/50 transition flex items-center gap-1">
                    <Trash2 size={10} /> Clear
                  </button>
                </div>
                {filteredHistory.map((h) => (
                  <div key={h} onClick={() => runSearch(h)}
                    className="flex items-center justify-between px-5 py-3 hover:bg-white/[0.05] cursor-pointer transition group/item">
                    <div className="flex items-center gap-3 min-w-0">
                      <Search size={12} className="text-white/15 shrink-0" />
                      <span className="text-sm text-white/40 truncate group-hover/item:text-white/70 transition">{h}</span>
                    </div>
                    <button onClick={(e) => handleRemoveHistory(e, h)}
                      className="text-white/15 hover:text-white/50 transition opacity-0 group-hover/item:opacity-100 shrink-0 ml-2">
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Buttons */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="flex flex-col items-center gap-3 mb-8">
          <div className="flex gap-3">
            <button onClick={handleScan} disabled={scanning}
              className="group/btn relative flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] bg-white/[0.06] border border-white/[0.08] text-white/40 hover:text-white/80 hover:bg-white/[0.1] hover:border-white/[0.18] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_20px_rgba(255,255,255,0.06),0_0_40px_rgba(255,255,255,0.02)] backdrop-blur-xl transition-all duration-300 disabled:opacity-25 disabled:cursor-not-allowed shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <FolderSearch size={14} /> Index folder
              <div className="absolute inset-0 rounded-xl bg-white/[0.05] opacity-0 group-hover/btn:opacity-100 blur-xl transition-opacity duration-300 pointer-events-none" />
            </button>
            <button onClick={handleGoogleDrive} disabled={scanning}
              className="group/btn relative flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] bg-white/[0.06] border border-white/[0.08] text-white/40 hover:text-white/80 hover:bg-white/[0.1] hover:border-white/[0.18] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_20px_rgba(255,255,255,0.06),0_0_40px_rgba(255,255,255,0.02)] backdrop-blur-xl transition-all duration-300 disabled:opacity-25 disabled:cursor-not-allowed shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 19.5h20L12 2z"/><path d="M2 19.5l5-8.5"/><path d="M22 19.5l-5-8.5"/><path d="M7 11h10"/></svg>
              Google Drive
              <div className="absolute inset-0 rounded-xl bg-white/[0.05] opacity-0 group-hover/btn:opacity-100 blur-xl transition-opacity duration-300 pointer-events-none" />
            </button>
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none group">
            <div className="relative w-3.5 h-3.5">
              <input type="checkbox" checked={!ocrEnabled}
                onChange={(e) => { const v = !e.target.checked; setOcrEnabled(v); localStorage.setItem('ocular_ocr_enabled', v) }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
              <div className={`w-3.5 h-3.5 rounded border transition-all duration-200 flex items-center justify-center ${!ocrEnabled ? 'bg-white/80 border-white/80' : 'border-white/20'}`}>
                {!ocrEnabled && <svg className="w-2.5 h-2.5 text-black" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 6l3 3 5-5"/></svg>}
              </div>
            </div>
            <span className="text-[11px] text-white/25 group-hover:text-white/40 transition-colors">Exclude images for faster indexing</span>
          </label>
        </motion.div>

        {/* Browser support warning */}
        {!supportsFS && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="mb-8 p-4 rounded-2xl bg-white/[0.04] border border-white/[0.08] text-center">
            <p className="text-white/40 text-sm">
              Your browser doesn't support folder scanning. Please use <span className="text-white/70">Chrome</span> or <span className="text-white/70">Edge</span>.
            </p>
          </motion.div>
        )}

        {/* Results */}
        <div className="space-y-3">
          <AnimatePresence mode="wait">
            {results.length > 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-4 mb-5">
                <p className="text-white/20 text-[11px] font-mono tracking-[0.15em]">
                  {results.length} RESULT{results.length !== 1 ? 'S' : ''}
                </p>
                <div className="h-[1px] flex-1 bg-gradient-to-r from-white/[0.12] to-transparent shadow-[0_0_8px_rgba(255,255,255,0.06)]" />
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {results.map((item, i) => (
              <ResultCard key={`${item.filepath}-${i}`} item={item} index={i} searchQuery={query} />
            ))}
          </AnimatePresence>

          {hasSearched && !results.length && !searching && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-14">
              <div className="relative inline-block mb-4">
                <Search size={28} className="text-white/15" strokeWidth={1.5} />
                <div className="absolute -inset-4 bg-white/5 rounded-full blur-2xl" />
              </div>
              <p className="text-white/25 text-sm">No results found</p>
              <p className="text-white/15 text-xs mt-1.5">Try different keywords or index some folders first</p>
            </motion.div>
          )}

          {!hasSearched && !results.length && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="text-center py-14">
              <div className="relative inline-block mb-5">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}>
                  <Orbit size={36} className="text-white/20" strokeWidth={1} />
                </motion.div>
                <motion.div
                  className="absolute -inset-6 bg-white/8 rounded-full blur-3xl"
                  animate={{ opacity: [0.5, 1, 0.5], scale: [1, 1.1, 1] }}
                  transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }} />
                <div className="absolute -inset-10 bg-white/3 rounded-full blur-[40px]" />
              </div>
              <p className="text-white/25 text-sm mb-6">
                {indexedCount > 0
                  ? `${indexedCount} files ready — start searching`
                  : 'Index a folder or connect Google Drive to get started'}
              </p>
              <RotatingTips />
            </motion.div>
          )}
        </div>
        <footer className="text-center py-4 text-white/20 text-xs">
          <a href="https://maryammeda.github.io/Ocular/privacy.html" target="_blank" rel="noopener noreferrer" className="hover:text-white/40 transition-colors">Privacy Policy</a>
          <span className="mx-2">·</span>
          <a href="https://maryammeda.github.io/Ocular/terms.html" target="_blank" rel="noopener noreferrer" className="hover:text-white/40 transition-colors">Terms of Service</a>
        </footer>
      </div>
    </div>
  )
}

export default App
