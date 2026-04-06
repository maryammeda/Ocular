import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, FolderOpen, Upload, Loader2, FileText, FileCode, FileImage, File, CheckCircle2, AlertCircle, X, Clock, Trash2, Sparkles, Plus, MessageCircle, Cloud, ArrowUp, ScanLine, Copy, Download } from 'lucide-react'
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import { engine } from './engine'
import { authorize, listFiles, downloadFile, pickFiles } from './gdrive'
import ApertureCanvas from './ApertureCanvas'
import ParticleCanvas from './ParticleCanvas'
import ParticleTitle from './ParticleTitle'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY || ''
const API_URL = import.meta.env.VITE_API_URL || ''

const FILTER_GROUPS = [
  { id: 'all',    label: 'All' },
  { id: 'docs',   label: 'Documents', match: ft => ['pdf','PDF','docx','DOCX','doc','DOC','txt','TXT','md','MD','csv','CSV','document'].includes(ft) },
  { id: 'images', label: 'Images',    match: ft => ['png','PNG','jpg','JPG','jpeg','JPEG','gif','GIF','webp','WEBP','image'].includes(ft) },
  { id: 'gdocs',  label: 'Google Docs', match: ft => ft === 'GDOC' },
  { id: 'sheets', label: 'Sheets',    match: ft => ft === 'GSHEET' },
  { id: 'code',   label: 'Code',      match: ft => ['py','js','jsx','ts','tsx','html','css','json','sql','sh'].includes(ft) },
]

const fileIconMap = {
  py: FileCode, js: FileCode, jsx: FileCode, ts: FileCode, tsx: FileCode,
  html: FileCode, css: FileCode, json: FileCode, sql: FileCode, sh: FileCode,
  md: FileText, txt: FileText, pdf: FileText, docx: FileText, doc: FileText, csv: FileText,
  png: FileImage, jpg: FileImage, jpeg: FileImage, gif: FileImage, svg: FileImage, webp: FileImage,
}
function getFileIcon(filename, size = 16) {
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
      initial={{ opacity: 0, x: 60 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 60 }}
      className="fixed top-6 right-6 z-[70] flex items-center gap-3 px-5 py-3.5 rounded-2xl max-w-sm"
      style={{ background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(40px)', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}
    >
      {type === 'success'
        ? <CheckCircle2 size={16} className="text-white/70 shrink-0" />
        : <AlertCircle size={16} className="text-white/70 shrink-0" />}
      <span className="text-sm text-white/80" style={{ fontWeight: 300 }}>{message}</span>
      <button onClick={onClose} className="ml-1 text-white/30 hover:text-white transition"><X size={14} /></button>
    </motion.div>
  )
}

// ── Scan Overlay ───────────────────────────────────────────
function ScanOverlay({ label, fileCount, currentFile, isOcr }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-40 bg-black/80 backdrop-blur-2xl flex items-center justify-center">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="flex flex-col items-center gap-8">
        {/* Orbital spinner */}
        <div className="relative w-16 h-16">
          <motion.svg viewBox="0 0 48 48" className="absolute inset-0 w-full h-full"
            animate={{ rotate: 360 }} transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}>
            <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
            <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1"
              strokeDasharray="30 95" strokeLinecap="round" />
          </motion.svg>
          <motion.svg viewBox="0 0 48 48" className="absolute inset-0 w-full h-full"
            animate={{ rotate: -360 }} transition={{ duration: 5, repeat: Infinity, ease: 'linear' }}>
            <circle cx="24" cy="24" r="16" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
            <circle cx="24" cy="24" r="16" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5"
              strokeDasharray="20 80" strokeLinecap="round" />
          </motion.svg>
        </div>
        <div className="text-center">
          <p className="text-white text-lg" style={{ fontWeight: 400 }}>{label}</p>
          <motion.p className="text-white/40 text-sm mt-2" style={{ fontWeight: 300 }}
            animate={{ opacity: [0.3, 0.7, 0.3] }} transition={{ duration: 2, repeat: Infinity }}>
            {isOcr ? 'Running OCR on images...' : 'Crawling and indexing files...'}
          </motion.p>
          {fileCount > 0 && (
            <p className="text-white/25 text-xs mt-4 font-mono">{fileCount} files indexed</p>
          )}
          {currentFile && (
            <p className="text-white/15 text-[10px] mt-1 font-mono truncate max-w-[300px]">{currentFile}</p>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── Result Card ────────────────────────────────────────────
function ResultCard({ item, index, searchQuery }) {
  const [hovered, setHovered] = useState(false)
  const [copied, setCopied] = useState(false)
  const [imgSrc, setImgSrc] = useState(null)
  const timer = useRef(null)
  const doc = useRef(null)

  const handleCopy = (e) => {
    e.stopPropagation()
    navigator.clipboard.writeText(item.filepath)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const onEnter = () => {
    timer.current = setTimeout(async () => {
      setHovered(true)
      if (!doc.current) doc.current = engine.getDocument(item.filepath)
      if (item.isImage && !imgSrc) {
        const data = await engine.getImageData(item.filepath)
        if (data) setImgSrc(data)
      }
    }, 400)
  }
  const onLeave = () => { clearTimeout(timer.current); setHovered(false) }

  const hl = (text) => {
    if (!text || !searchQuery) return text
    const t = text.length > 800 ? text.slice(0, 800) + '...' : text
    const parts = t.split(new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
    return parts.map((p, i) => p.toLowerCase() === searchQuery.toLowerCase()
      ? <mark key={i} className="bg-white/15 text-white rounded-sm px-0.5">{p}</mark> : p)
  }

  const preview = doc.current

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.4 }}
      whileHover={{ y: -4 }}
      onMouseEnter={onEnter} onMouseLeave={onLeave}
      className="group relative rounded-2xl p-6 cursor-default overflow-hidden"
      style={{
        background: 'linear-gradient(145deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
        backdropFilter: 'blur(40px)',
        border: '1px solid rgba(255,255,255,0.09)',
        boxShadow: '0 1px 0 rgba(255,255,255,0.08) inset, 0 20px 60px rgba(0,0,0,0.5)',
      }}
    >
      {/* Shimmer line */}
      <div className="absolute top-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-white/[0.18] to-transparent" />
      {/* Hover glow */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none"
        style={{ background: 'radial-gradient(600px circle at 30% 20%, rgba(255,255,255,0.04), transparent 40%)' }} />

      <div className="relative">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-white/30 group-hover:text-white/60 transition-colors shrink-0">
              {getFileIcon(item.filename)}
            </span>
            <h3 className="text-[0.9rem] text-white truncate" style={{ fontWeight: 500, letterSpacing: '-0.01em' }}>
              {item.filename}
            </h3>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-3">
            {item.filetype && (
              <span className="text-[0.65rem] uppercase tracking-widest text-white/40 border border-white/15 rounded-full px-2.5 py-0.5">
                {item.filetype}
              </span>
            )}
            {item.matches > 1 && (
              <span className="text-[0.65rem] text-white/30 border border-white/10 rounded-full px-2.5 py-0.5">
                {item.matches}
              </span>
            )}
          </div>
        </div>

        <p className="text-[0.82rem] text-white/45 leading-relaxed [&>b]:text-white/90 [&>b]:font-medium" style={{ fontWeight: 300 }}
          dangerouslySetInnerHTML={{ __html: item.snippet }} />

        <div className="flex items-center justify-between mt-3 gap-2">
          <p className="text-[10px] text-white/20 font-mono truncate">{item.filepath}</p>
          <button onClick={handleCopy}
            className="shrink-0 text-white/20 hover:text-white/60 transition-colors"
            title="Copy path">
            {copied ? <CheckCircle2 size={12} className="text-white/50" /> : <Copy size={12} />}
          </button>
        </div>

        <AnimatePresence>
          {hovered && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3 }} className="overflow-hidden">
              <div className="mt-4 pt-4 border-t border-white/[0.06]">
                {preview?.isImage && imgSrc && (
                  <div className="space-y-3">
                    <img src={imgSrc} alt={preview.filename}
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
  'Index any folder on your computer using the scan panel',
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
    <AnimatePresence mode="wait">
      <motion.p
        key={index}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.3 }}
        className="text-white/40 text-xs text-center" style={{ fontWeight: 300 }}
      >
        Tip: {TIPS[index]}
      </motion.p>
    </AnimatePresence>
  )
}

// ── Chat History (multi-conversation) ─────────────────────
const CHK = 'ocular_chats'
const ACTIVE_CHK = 'ocular_active_chat'

function getAllChats() {
  try { return JSON.parse(localStorage.getItem(CHK)) || [] } catch { return [] }
}
function saveAllChats(chats) {
  localStorage.setItem(CHK, JSON.stringify(chats.slice(0, 20))) // keep last 20 conversations
}
function getActiveId() {
  return localStorage.getItem(ACTIVE_CHK) || null
}
function setActiveId(id) {
  localStorage.setItem(ACTIVE_CHK, id)
}
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}
function getChatTitle(msgs) {
  const first = msgs.find(m => m.role === 'user')
  if (!first) return 'New Chat'
  return first.text.slice(0, 40) + (first.text.length > 40 ? '...' : '')
}

// ── Typing Indicator ──────────────────────────────────────
function TypingDots() {
  return (
    <div className="flex items-center gap-1.5 py-2 px-1">
      {[0, 1, 2].map(i => (
        <motion.div key={i} className="w-2 h-2 rounded-full bg-white/40"
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }} />
      ))}
    </div>
  )
}

// ── Chat Panel ────────────────────────────────────────────
function ChatPanel({ open, onClose, indexedCount, onSearchFile }) {
  const [chats, setChats] = useState(getAllChats)
  const [activeChat, setActiveChat] = useState(() => {
    const id = getActiveId()
    const all = getAllChats()
    return all.find(c => c.id === id) || null
  })
  const [messages, setMessages] = useState(() => activeChat?.messages || [])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const endRef = useRef(null)
  const inputRef = useRef(null)
  const saveTimer = useRef(null)
  const latestChats = useRef(null)

  // Save messages to active chat (debounced to avoid thrashing localStorage during streaming)
  useEffect(() => {
    if (!activeChat) return
    const updated = chats.map(c => c.id === activeChat.id ? { ...c, messages } : c)
    setChats(updated)
    latestChats.current = updated
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveAllChats(updated), 500)
  }, [messages])

  // Flush pending save on unmount
  useEffect(() => {
    return () => {
      clearTimeout(saveTimer.current)
      if (latestChats.current) saveAllChats(latestChats.current)
    }
  }, [])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 300)
  }, [open])
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const newChat = () => {
    const chat = { id: generateId(), messages: [], created: Date.now() }
    const updated = [chat, ...chats]
    setChats(updated)
    saveAllChats(updated)
    setActiveChat(chat)
    setActiveId(chat.id)
    setMessages([])
    setShowHistory(false)
  }

  const switchChat = (chat) => {
    setActiveChat(chat)
    setActiveId(chat.id)
    setMessages(chat.messages || [])
    setShowHistory(false)
  }

  const deleteChat = (e, chatId) => {
    e.stopPropagation()
    const updated = chats.filter(c => c.id !== chatId)
    setChats(updated)
    saveAllChats(updated)
    if (activeChat?.id === chatId) {
      if (updated.length > 0) {
        switchChat(updated[0])
      } else {
        setActiveChat(null)
        setMessages([])
      }
    }
  }

  // Auto-create a chat if none exists when sending first message
  const ensureActiveChat = () => {
    if (!activeChat) {
      const chat = { id: generateId(), messages: [], created: Date.now() }
      const updated = [chat, ...chats]
      setChats(updated)
      saveAllChats(updated)
      setActiveChat(chat)
      setActiveId(chat.id)
      return chat
    }
    return activeChat
  }

  const sendMessage = async () => {
    const q = input.trim()
    if (!q || loading) return
    setInput('')
    ensureActiveChat()

    const userMsg = { role: 'user', text: q }
    const aiMsg = { role: 'ai', text: '', sources: [] }
    setMessages(prev => [...prev, userMsg, aiMsg])
    setLoading(true)

    try {
      // Simple approach: send ALL documents to the AI, let it figure out relevance.
      // Truncate each doc to fit within model context limits.
      const allDocs = engine.documents || []
      if (!allDocs.length) throw new Error('No documents indexed yet. Scan a folder or connect Google Drive first.')

      // Budget: ~80K chars total for sources. Divide evenly across docs.
      const MAX_TOTAL_CHARS = 80000
      const charsPerDoc = Math.max(200, Math.floor(MAX_TOTAL_CHARS / allDocs.length))

      const sources = allDocs.map(doc => ({
        filename: doc.filename,
        filepath: doc.filepath,
        content: (doc.content || '').slice(0, charsPerDoc),
      })).filter(s => s.content.length > 0)

      // Build conversation history from last 3 completed exchanges
      const history = []
      for (let i = 0; i < messages.length - 1; i++) {
        const m = messages[i], next = messages[i + 1]
        if (m.role === 'user' && next.role === 'ai' && next.text && !next.isError) {
          history.push({ role: 'user', content: m.text })
          history.push({ role: 'assistant', content: next.text })
        }
      }

      const res = await fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, sources, history: history.slice(-6) }),
      })
      if (!res.ok) throw new Error(`Server error: ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        let currentEvent = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            const data = line.slice(6)
            try {
              const parsed = JSON.parse(data)
              if (currentEvent === 'sources') {
                setMessages(prev => {
                  const updated = [...prev]
                  updated[updated.length - 1] = { ...updated[updated.length - 1], sources: parsed }
                  return updated
                })
              } else if (currentEvent === 'token') {
                setMessages(prev => {
                  const updated = [...prev]
                  const last = updated[updated.length - 1]
                  updated[updated.length - 1] = { ...last, text: last.text + parsed.text }
                  return updated
                })
              } else if (currentEvent === 'error') {
                setMessages(prev => {
                  const updated = [...prev]
                  updated[updated.length - 1] = { ...updated[updated.length - 1], text: parsed.message, isError: true }
                  return updated
                })
              }
            } catch { /* skip malformed JSON */ }
            currentEvent = ''
          }
        }
      }
    } catch (err) {
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          text: err.message || 'Failed to connect to backend.',
          isError: true,
        }
        return updated
      })
    } finally {
      setLoading(false)
    }
  }

  const handleKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />

          {/* Panel — slides from right, takes ~1/3 of screen */}
          <motion.div
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed top-0 right-0 bottom-0 z-50 flex"
            style={{
              width: 'min(520px, 40vw)',
              minWidth: '360px',
              background: 'linear-gradient(180deg, rgba(8,8,8,0.99), rgba(0,0,0,0.99))',
              backdropFilter: 'blur(60px)',
              borderLeft: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            {/* Chat history sidebar */}
            <AnimatePresence>
              {showHistory && (
                <motion.div
                  initial={{ width: 0, opacity: 0 }} animate={{ width: 200, opacity: 1 }} exit={{ width: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="h-full overflow-hidden flex-shrink-0"
                  style={{ borderRight: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <div className="w-[200px] h-full flex flex-col">
                    <div className="px-3 pt-5 pb-3">
                      <button onClick={newChat}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] text-white/50 hover:text-white/80 hover:bg-white/[0.06] transition-all border border-white/[0.08]" style={{ fontWeight: 400 }}>
                        <Plus size={12} /> New Chat
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5">
                      {chats.map(chat => (
                        <div key={chat.id}
                          onClick={() => switchChat(chat)}
                          className={`group flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-all text-[11px] truncate ${
                            activeChat?.id === chat.id ? 'bg-white/[0.08] text-white/70' : 'text-white/35 hover:bg-white/[0.04] hover:text-white/50'
                          }`} style={{ fontWeight: 300 }}>
                          <span className="truncate">{getChatTitle(chat.messages)}</span>
                          <button onClick={(e) => deleteChat(e, chat.id)}
                            className="opacity-0 group-hover:opacity-100 text-white/20 hover:text-white/60 transition shrink-0 ml-1">
                            <X size={10} />
                          </button>
                        </div>
                      ))}
                      {chats.length === 0 && (
                        <p className="text-white/15 text-[10px] text-center px-3 pt-4" style={{ fontWeight: 300 }}>No conversations yet</p>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Main chat area */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3">
                  <button onClick={() => setShowHistory(!showHistory)}
                    className="text-white/30 hover:text-white/60 transition p-1">
                    <Clock size={16} />
                  </button>
                  <span className="font-heading text-lg text-white">Ocular AI</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {messages.filter(m => m.text && !m.isError).length > 0 && (
                    <button
                      onClick={() => {
                        const text = messages
                          .filter(m => m.text && !m.isError)
                          .map(m => `${m.role === 'user' ? 'You' : 'Ocular AI'}: ${m.text}`)
                          .join('\n\n')
                        const blob = new Blob([text], { type: 'text/plain' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = `${getChatTitle(messages) || 'chat'}.txt`
                        a.click()
                        URL.revokeObjectURL(url)
                      }}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-all"
                      style={{ fontWeight: 400 }} title="Export chat">
                      <Download size={12} />
                    </button>
                  )}
                  <button onClick={newChat}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-all" style={{ fontWeight: 400 }}>
                    <Plus size={12} /> New
                  </button>
                  <button onClick={onClose} className="text-white/30 hover:text-white/60 transition p-1"><X size={16} /></button>
                </div>
              </div>

              {/* Divider */}
              <div className="h-px mx-5" style={{ background: 'rgba(255,255,255,0.06)' }} />

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                {messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-center gap-4">
                    <Sparkles size={28} className="text-white/15" />
                    {indexedCount > 0 ? (
                      <>
                        <p className="text-white/30 text-sm" style={{ fontWeight: 300 }}>Ask anything about your files</p>
                        <p className="text-white/15 text-xs">{indexedCount} files indexed</p>
                      </>
                    ) : (
                      <p className="text-white/30 text-sm" style={{ fontWeight: 300 }}>Index some files first</p>
                    )}
                  </div>
                )}

                {messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[90%] ${msg.role === 'user'
                      ? 'liquid-glass-strong rounded-2xl rounded-br-sm px-4 py-2.5'
                      : 'w-full'}`}>
                      {msg.role === 'user' ? (
                        <p className="text-[0.85rem] text-white/80 leading-relaxed" style={{ fontWeight: 300 }}>{msg.text}</p>
                      ) : (
                        <div className="space-y-2">
                          {msg.isError ? (
                            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
                              <AlertCircle size={14} className="text-red-400/70 mt-0.5 shrink-0" />
                              <p className="text-[0.85rem] text-red-300/70 leading-relaxed">{msg.text}</p>
                            </div>
                          ) : msg.text ? (
                            <div className="text-[0.85rem] text-white/70 leading-relaxed prose prose-invert prose-sm max-w-none
                              [&_p]:mb-2 [&_p:last-child]:mb-0
                              [&_ul]:mb-2 [&_ol]:mb-2 [&_li]:mb-0.5
                              [&_code]:bg-white/[0.08] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[12px]
                              [&_pre]:bg-white/[0.05] [&_pre]:border [&_pre]:border-white/[0.08] [&_pre]:rounded-xl [&_pre]:p-3 [&_pre]:overflow-x-auto
                              [&_strong]:text-white/90 [&_h1]:text-white/90 [&_h2]:text-white/90 [&_h3]:text-white/90
                              [&_a]:text-white/60 [&_a]:underline" style={{ fontWeight: 300 }}>
                              <ReactMarkdown>{msg.text}</ReactMarkdown>
                            </div>
                          ) : loading && i === messages.length - 1 ? (
                            <TypingDots />
                          ) : null}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {loading && messages.length > 0 && messages[messages.length - 1]?.text && (
                  <div className="flex justify-start"><TypingDots /></div>
                )}
                <div ref={endRef} />
              </div>

              {/* Input */}
              <div className="px-5 pb-5 pt-3">
                <div className="liquid-glass-strong rounded-full flex items-center px-4 h-11">
                  <input ref={inputRef} type="text" value={input}
                    onChange={(e) => setInput(e.target.value)} onKeyDown={handleKey}
                    placeholder={indexedCount > 0 ? "Ask about your documents..." : "Index files first..."}
                    disabled={loading || indexedCount === 0}
                    className="flex-1 bg-transparent border-none outline-none text-white text-[0.85rem] placeholder-white/25 disabled:opacity-30" style={{ fontWeight: 300 }} />
                  <button onClick={sendMessage} disabled={!input.trim() || loading || indexedCount === 0}
                    className="w-7 h-7 rounded-full bg-white flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed transition-opacity">
                    <ArrowUp size={14} className="text-black" />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
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
  const [activeFilter, setActiveFilter] = useState('all')
  const [history, setHistory] = useState(getHistory())
  const [showHistory, setShowHistory] = useState(false)
  const [indexedCount, setIndexedCount] = useState(0)
  const [ready, setReady] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [ocrEnabled, setOcrEnabled] = useState(() => localStorage.getItem('ocular_ocr_enabled') !== 'false')
  const [includeShared, setIncludeShared] = useState(() => localStorage.getItem('ocular_include_shared') !== 'false')
  const [isOcr, setIsOcr] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [scanPanelOpen, setScanPanelOpen] = useState(false)
  const [clearConfirm, setClearConfirm] = useState(false)
  const [snapCount, setSnapCount] = useState(0)
  const [showFullDriveSetup, setShowFullDriveSetup] = useState(false)
  const [userClientId, setUserClientId] = useState(() => localStorage.getItem('ocular_user_gdrive_client_id') || '')
  const inputRef = useRef(null)
  const historyRef = useRef(null)
  const dragCounter = useRef(0)

  const notify = (msg, type = 'success') => setToast({ message: msg, type })

  // Hero parallax
  const { scrollY } = useScroll()
  const heroY = useTransform(scrollY, [0, 600], [0, 45])
  const heroOpacity = useTransform(scrollY, [0, 400], [1, 0])

  // Init engine
  useEffect(() => {
    engine.init().then(() => {
      setIndexedCount(engine.count)
      setReady(true)
    }).catch(() => setReady(true))
  }, [])

  useEffect(() => { if (ready) inputRef.current?.focus() }, [ready])

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setScanPanelOpen(false)
        setChatOpen(false)
        inputRef.current?.focus()
        inputRef.current?.select()
      }
      if (e.key === 'Escape') {
        setScanPanelOpen(false)
        setChatOpen(false)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])
  useEffect(() => {
    const h = (e) => {
      if (historyRef.current && !historyRef.current.contains(e.target)) setShowHistory(false)
    }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])

  const onProgress = useCallback((count, filename, ocrActive) => {
    setScanCount(count)
    setScanFile(filename)
    if (ocrActive !== undefined) setIsOcr(ocrActive)
  }, [])

  const runSearch = (sq) => {
    if (!sq.trim()) return; setQuery(sq); setSearching(true); setHasSearched(true); setShowHistory(false); setActiveFilter('all')
    addToHistory(sq); setHistory(getHistory())
    setSnapCount(c => c + 1) // trigger aperture snap
    const r = engine.search(sq)
    setResults(r)
    if (!r.length) notify('No matches found.', 'error')
    setSearching(false)
  }
  const handleSearch = (e) => { e.preventDefault(); runSearch(query) }
  const handleRemoveHistory = (e, q) => { e.stopPropagation(); removeFromHistory(q); setHistory(getHistory()) }
  const handleClearHistory = (e) => { e.stopPropagation(); clearHistory(); setHistory([]) }

  const handleClearIndex = async () => {
    await engine.clearAll()
    setIndexedCount(0)
    setClearConfirm(false)
  }
  const filteredHistory = query.trim()
    ? history.filter(h => h.toLowerCase().includes(query.toLowerCase()) && h.toLowerCase() !== query.toLowerCase()) : history

  // ── Index folder ─────────────────────────────────────────
  const handleScan = async () => {
    setScanPanelOpen(false)
    if (!supportsFS) return notify('Please use Chrome or Edge to scan folders.', 'error')
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'read' })
      setScanning(true); setScanCount(0); setScanFile(''); setIsOcr(false); setScanLabel(`Scanning ${dirHandle.name}`)
      const count = await engine.scanDirectory(dirHandle, onProgress, { ocrEnabled })
      setIndexedCount(await engine.syncCount())
      notify(`Done — ${count} files indexed from ${dirHandle.name}`)
    } catch (e) {
      if (e.name !== 'AbortError') notify(e.message, 'error')
    } finally { setScanning(false) }
  }

  // ── Google Drive shared processing ──────────────────────
  const processDriveFiles = async (token, files, label) => {
    setScanning(true); setScanCount(0); setScanFile(''); setIsOcr(false)
    setScanLabel(label)

    let count = 0
    let skipped = 0

    // Skip files already indexed with the same modifiedTime (no re-download needed)
    const existingMtimes = new Map(
      engine.documents.filter(d => d.driveMtime).map(d => [d.filepath, d.driveMtime])
      // filepath is now "Google Drive/${file.id}" so this map is keyed by ID — no duplicate collisions
    )
    const newFiles = files.filter(f => {
      if (!ocrEnabled && f.mimeType.startsWith('image/')) return false
      if (!includeShared && f.ownedByMe === false) return false
      const stored = existingMtimes.get(`Google Drive/${f.id}`)
      return !stored || stored !== f.modifiedTime
    })
    // Process owned files first so the user's own content is always indexed first
    newFiles.sort((a, b) => (b.ownedByMe === true) - (a.ownedByMe === true))
    const alreadyIndexed = files.length - newFiles.length

    if (alreadyIndexed > 0) {
      count = alreadyIndexed
      onProgress(count, `${alreadyIndexed} files already indexed, processing new ones...`)
    }

    const withTimeout = (promise, ms) =>
      Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))])

    const processFile = async (file) => {
      const result = await withTimeout(downloadFile(token, file), 15000)
      let content = ''
      let isImage = false
      let imageData = null

      if (result.type === 'text') {
        content = result.data
      } else if (result.type === 'image') {
        isImage = true
        imageData = result.data
        content = ocrEnabled ? await withTimeout(engine.ocrFromDataURL(result.data), 20000) : ''
      } else if (result.type === 'binary') {
        if (result.mimeType === 'application/pdf') {
          content = await withTimeout(engine.extractPDFFromBuffer(result.data), 15000)
        } else {
          content = await withTimeout(engine.extractDOCXFromBuffer(result.data), 10000)
        }
      }

      await engine.addDocument({
        filename: file.name,
        filepath: `Google Drive/${file.id}`,
        content,
        filetype: result.filetype,
        isImage,
        imageData,
        driveMtime: file.modifiedTime || null,
      })
    }

    // More workers when OCR is off (pure network I/O) vs on (CPU-bound OCR limits gains)
    const CONCURRENCY = ocrEnabled ? 6 : 10
    let idx = 0
    const failedFiles = []
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (idx < newFiles.length) {
          const file = newFiles[idx++]
          try {
            await withTimeout(processFile(file), 30000)
            count++
          } catch (e) {
            failedFiles.push(file)
          }
          onProgress(count, file.name)
        }
      })
    )

    // Retry failed files one at a time with a longer timeout
    if (failedFiles.length > 0) {
      onProgress(count, `Retrying ${failedFiles.length} files...`)
      for (const file of failedFiles) {
        try {
          await withTimeout(processFile(file), 60000)
          count++
        } catch (e) {
          skipped++
        }
        onProgress(count, file.name)
      }
    }

    setIndexedCount(await engine.syncCount())
    setScanning(false)
    const msg = skipped > 0
      ? `Indexed ${count} files from Google Drive (${skipped} couldn't be read)`
      : `Indexed ${count} files from Google Drive`
    notify(msg)
  }

  const handleQuickScan = async () => {
    setScanPanelOpen(false)
    if (!GOOGLE_API_KEY) return notify('Picker API key not configured yet.', 'error')
    try {
      const { token, files } = await pickFiles(GOOGLE_CLIENT_ID, GOOGLE_API_KEY)
      await processDriveFiles(token, files, `Indexing ${files.length} selected files`)
    } catch (e) {
      if (!e.message?.includes('popup_closed')) notify(e.message, 'error')
    }
  }

  const handleFullDriveScan = async () => {
    setScanPanelOpen(false)
    setShowFullDriveSetup(true)
  }

  const startFullDriveScanFromSetup = async () => {
    if (!userClientId.trim()) return notify('Please enter a Client ID.', 'error')
    localStorage.setItem('ocular_user_gdrive_client_id', userClientId.trim())
    setShowFullDriveSetup(false)
    try {
      const token = await authorize(userClientId.trim())
      setScanLabel('Fetching files from Google Drive')
      setScanning(true); setScanCount(0); setScanFile(''); setIsOcr(false)
      const files = await listFiles(token)
      await processDriveFiles(token, files, `Indexing ${files.length} files from Google Drive`)
    } catch (e) {
      if (!e.message?.includes('popup_closed')) notify(e.message, 'error')
      setScanning(false)
    }
  }


  // ── Drag & drop ──────────────────────────────────────────
  const handleDragEnter = (e) => { e.preventDefault(); dragCounter.current++; setDragging(true) }
  const handleDragLeave = (e) => { e.preventDefault(); dragCounter.current--; if (dragCounter.current === 0) setDragging(false) }
  const handleDragOver = (e) => { e.preventDefault() }
  const handleDrop = async (e) => {
    e.preventDefault(); dragCounter.current = 0; setDragging(false)
    const items = [...e.dataTransfer.items]
    if (!items.length) return
    setScanning(true); setScanCount(0); setScanFile(''); setIsOcr(false); setScanLabel('Scanning dropped files')
    try {
      const count = await engine.scanDroppedItems(items, onProgress, { ocrEnabled })
      setIndexedCount(await engine.syncCount())
      notify(`Done — ${count} files indexed`)
    } catch (err) {
      notify(err.message, 'error')
    } finally { setScanning(false) }
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="text-white/30 animate-spin" size={24} />
      </div>
    )
  }

  return (
    <>
    <AnimatePresence>{toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}</AnimatePresence>
    <div className="min-h-screen bg-black text-white selection:bg-white/20 relative"
      style={{ fontFamily: "'Barlow', sans-serif" }}
      onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}>

      {/* Grain overlay */}
      <div className="grain-overlay" />

      {/* ── NAVBAR ────────────────────────────────────────── */}
      <div style={{ position: 'fixed', top: '1rem', left: '50%', transform: 'translateX(-50%)', width: 'calc(100% - 2rem)', maxWidth: '72rem', zIndex: 50 }}>
        <motion.nav
          initial={{ y: -18, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 1.1 }}
          className="liquid-glass rounded-full px-5 h-14 flex items-center"
        >
          <div className="flex-1">
            <span className="font-heading text-xl text-white tracking-tight">Ocular</span>
          </div>
          <div className="flex items-center gap-6">
            {['Scan', 'Chat'].map(label => (
              <button key={label}
                onClick={() => {
                  if (label === 'Scan') setScanPanelOpen(true)
                  if (label === 'Chat') setChatOpen(true)
                }}
                className="text-sm text-white/50 hover:text-white transition-colors" style={{ fontWeight: 400 }}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex-1" />
        </motion.nav>
      </div>

      {/* ── HERO ──────────────────────────────────────────── */}
      <section className="relative h-screen min-h-[600px] overflow-hidden">
        <ApertureCanvas triggerSnap={snapCount} />
        <ParticleCanvas />

        <motion.div
          style={{ y: heroY, opacity: heroOpacity }}
          className="relative z-10 flex flex-col items-center h-full px-6 pt-[18vh]"
        >
          {/* Particle Title */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ delay: 0.3, duration: 1 }}
            className="w-full max-w-[1200px] mb-6"
          >
            <ParticleTitle text="OCULAR" />
          </motion.div>

          {/* Subtext */}
          <motion.p
            initial={{ opacity: 0, filter: 'blur(8px)' }}
            animate={{ opacity: 1, filter: 'blur(0px)' }}
            transition={{ delay: 0.8, duration: 0.8 }}
            className="text-white/50 text-[1rem] text-center max-w-2xl mb-6"
            style={{ fontWeight: 300 }}
          >
            Search inside your screenshots, documents, and images. Powered by computer vision and OCR — your files are no longer invisible.
          </motion.p>

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ delay: 1.0, duration: 0.6 }}
            className="flex items-center gap-3 mb-8"
          >
            {indexedCount > 0 && (
              <span className="liquid-glass rounded-full px-4 py-1.5 text-white/50 text-xs" style={{ fontWeight: 400 }}>
                {indexedCount} documents indexed
              </span>
            )}
          </motion.div>

          {/* Search Bar */}
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.1, duration: 0.6 }}
            className="w-full max-w-3xl relative" ref={historyRef}
          >
            <form onSubmit={handleSearch}>
              <div className="liquid-glass-strong rounded-full flex items-center px-6 h-14">
                {searching
                  ? <Loader2 className="text-white/40 animate-spin shrink-0" size={20} />
                  : <Search className="text-white/30 shrink-0" size={20} />}
                <input ref={inputRef} type="text" value={query}
                  onChange={(e) => setQuery(e.target.value)} onClick={() => setShowHistory(true)}
                  placeholder={indexedCount > 0 ? `Search ${indexedCount.toLocaleString()} files...` : "Search your knowledge base..."}
                  className="flex-1 bg-transparent border-none outline-none text-white text-[0.95rem] placeholder-white/25 ml-3"
                  style={{ fontWeight: 300 }} />
                {query && (
                  <button type="button"
                    onClick={() => { setQuery(''); setResults([]); setHasSearched(false); inputRef.current?.focus() }}
                    className="text-white/25 hover:text-white/60 transition shrink-0">
                    <X size={18} />
                  </button>
                )}
              </div>
            </form>

            {/* History dropdown */}
            <AnimatePresence>
              {showHistory && filteredHistory.length > 0 && (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }}
                  className="absolute top-full left-0 right-0 mt-2 liquid-glass rounded-2xl overflow-hidden shadow-[0_16px_60px_rgba(0,0,0,0.4)] z-20">
                  <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
                    <span className="text-[10px] text-white/25 tracking-[0.15em] flex items-center gap-2" style={{ fontWeight: 500 }}>
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
                        <span className="text-sm text-white/40 truncate group-hover/item:text-white/70 transition" style={{ fontWeight: 300 }}>{h}</span>
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

          <div className="mt-5">
            <RotatingTips />
          </div>

        </motion.div>

        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 z-5 h-[200px]"
          style={{ background: 'linear-gradient(to bottom, transparent 0%, black 100%)' }} />
      </section>

      {/* ── RESULTS SECTION ───────────────────────────────── */}
      {(hasSearched || results.length > 0) && (() => {
        const visibleFilters = FILTER_GROUPS.filter(f =>
          f.id === 'all' || results.some(r => f.match?.(r.filetype))
        )
        const filteredResults = activeFilter === 'all'
          ? results
          : results.filter(r => FILTER_GROUPS.find(f => f.id === activeFilter)?.match?.(r.filetype))

        return (
          <section className="bg-black px-6 py-16 min-h-[40vh]">
            <div className="max-w-7xl mx-auto">
              <AnimatePresence mode="wait">
                {results.length > 0 && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-8 space-y-4">
                    <p className="text-white/50 text-sm" style={{ fontWeight: 300 }}>
                      <span className="text-white/90" style={{ fontWeight: 500 }}>{filteredResults.length.toLocaleString()}</span>
                      {activeFilter !== 'all' && <span className="text-white/40"> of {results.length.toLocaleString()}</span>}
                      {' '}result{filteredResults.length !== 1 ? 's' : ''} for &lsquo;<span className="text-white/70">{query}</span>&rsquo;
                    </p>

                    {visibleFilters.length > 1 && (
                      <div className="flex flex-wrap gap-2">
                        {visibleFilters.map(f => {
                          const count = f.id === 'all' ? results.length : results.filter(r => f.match?.(r.filetype)).length
                          const active = activeFilter === f.id
                          return (
                            <button key={f.id} onClick={() => setActiveFilter(f.id)}
                              className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs transition-all duration-200"
                              style={{
                                fontWeight: active ? 500 : 300,
                                background: active ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)',
                                border: `1px solid ${active ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)'}`,
                                color: active ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)',
                              }}>
                              {f.label}
                              <span style={{ color: active ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)' }}>{count}</span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                <AnimatePresence>
                  {filteredResults.map((item, i) => (
                    <ResultCard key={`${item.filepath}-${i}`} item={item} index={i} searchQuery={query} />
                  ))}
                </AnimatePresence>
              </div>

              {hasSearched && !results.length && !searching && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-20">
                  <Search size={28} className="text-white/15 mx-auto mb-4" strokeWidth={1.5} />
                  <p className="text-white/25 text-sm" style={{ fontWeight: 300 }}>No results found</p>
                  <p className="text-white/15 text-xs mt-1.5">Try different keywords or index some folders first</p>
                </motion.div>
              )}

              {hasSearched && results.length > 0 && !filteredResults.length && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-20">
                  <p className="text-white/25 text-sm" style={{ fontWeight: 300 }}>No {FILTER_GROUPS.find(f => f.id === activeFilter)?.label} results</p>
                </motion.div>
              )}
            </div>
          </section>
        )
      })()}


      {/* ── FOOTER ────────────────────────────────────────── */}
      <footer className="bg-black px-6 pb-10 pt-20">
        <div className="max-w-7xl mx-auto">
          <div className="h-px w-full mb-8" style={{ background: 'rgba(255,255,255,0.12)' }} />
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-white/[0.38] text-xs" style={{ fontWeight: 300 }}>
              &copy; 2026 Ocular. All rights reserved.
            </p>
            <div className="flex items-center gap-6">
              {[
                { label: 'Privacy', href: 'https://ocular-app.tech/privacy.html' },
                { label: 'Terms', href: 'https://ocular-app.tech/terms.html' },
                { label: 'GitHub', href: 'https://github.com/maryammeda/Ocular' },
              ].map(link => (
                <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-white/[0.38] hover:text-white/70 transition-colors" style={{ fontWeight: 300 }}>
                  {link.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </footer>

      {/* ── SCAN PANEL (slide from right) ─────────────────── */}
      <AnimatePresence>
        {scanPanelOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={() => setScanPanelOpen(false)} />
            <motion.div
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed top-0 right-0 bottom-0 z-50 w-96 flex flex-col"
              style={{
                background: 'linear-gradient(180deg, rgba(8,8,8,0.98), rgba(0,0,0,0.99))',
                backdropFilter: 'blur(60px)',
                borderLeft: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <div className="flex items-center justify-between p-8 pb-4">
                <span className="font-heading text-2xl text-white">Index Files</span>
                <button onClick={() => setScanPanelOpen(false)} className="text-white/40 hover:text-white transition"><X size={18} /></button>
              </div>

              <div className="flex-1 p-8 pt-4 space-y-3">
                {[
                  { icon: FolderOpen, title: 'Scan Folder', desc: 'Choose a folder on your computer to index', action: handleScan },
                  { icon: Cloud, title: 'Select from Drive', desc: 'Pick files or folders from Google Drive', action: handleQuickScan },
                  { icon: Cloud, title: 'Full Drive Scan', desc: 'Index your entire Drive — one-time setup', action: handleFullDriveScan },
                ].map(({ icon: Icon, title, desc, action }) => (
                  <motion.button key={title}
                    whileHover={{ scale: 1.02 }}
                    onClick={action}
                    disabled={scanning}
                    className="w-full liquid-glass rounded-2xl p-5 text-left group transition-all disabled:opacity-30"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-11 h-11 rounded-2xl flex items-center justify-center"
                        style={{
                          background: 'linear-gradient(135deg, rgba(255,255,255,0.09), rgba(255,255,255,0.03))',
                          border: '1px solid rgba(255,255,255,0.12)',
                        }}>
                        <Icon size={18} className="text-white/75" />
                      </div>
                      <div>
                        <p className="text-[0.95rem] text-white mb-0.5" style={{ fontWeight: 500 }}>{title}</p>
                        <p className="text-[0.82rem] text-white/40" style={{ fontWeight: 300 }}>{desc}</p>
                      </div>
                    </div>
                  </motion.button>
                ))}

                {/* Toggles */}
                <div className="space-y-3 pt-4">
                  {[
                    { label: 'OCR (Image Scanning)', value: ocrEnabled, onChange: (v) => { setOcrEnabled(v); localStorage.setItem('ocular_ocr_enabled', v) } },
                    { label: 'Include Shared Files', value: includeShared, onChange: (v) => { setIncludeShared(v); localStorage.setItem('ocular_include_shared', v) } },
                  ].map(({ label, value, onChange }) => (
                    <div key={label} className="flex items-center justify-between px-2">
                      <span className="text-sm text-white/50" style={{ fontWeight: 300 }}>{label}</span>
                      <button
                        onClick={() => onChange(!value)}
                        className="relative w-11 h-6 rounded-full transition-colors duration-200"
                        style={{ background: value ? 'white' : 'rgba(255,255,255,0.1)' }}
                      >
                        <div className="absolute top-1 w-4 h-4 rounded-full transition-all duration-200"
                          style={{
                            left: value ? '24px' : '4px',
                            background: value ? 'black' : 'rgba(255,255,255,0.4)',
                          }} />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Clear Index */}
                {indexedCount > 0 && (
                  <div className="px-2 pt-5 border-t border-white/[0.06] mt-2">
                    {!clearConfirm ? (
                      <button
                        onClick={() => setClearConfirm(true)}
                        className="flex items-center gap-2 text-white/25 hover:text-red-400/70 transition-colors duration-200 text-sm"
                        style={{ fontWeight: 300 }}
                      >
                        <Trash2 size={13} />
                        Clear all indexed files
                      </button>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-[0.8rem] text-white/40" style={{ fontWeight: 300 }}>
                          Remove all {indexedCount} indexed files?
                        </p>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={handleClearIndex}
                            className="text-[0.82rem] text-red-400/80 hover:text-red-400 transition-colors"
                            style={{ fontWeight: 400 }}
                          >
                            Yes, clear
                          </button>
                          <button
                            onClick={() => setClearConfirm(false)}
                            className="text-[0.82rem] text-white/30 hover:text-white/60 transition-colors"
                            style={{ fontWeight: 300 }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── OVERLAYS ──────────────────────────────────────── */}
      <AnimatePresence>{scanning && <ScanOverlay label={scanLabel} fileCount={scanCount} currentFile={scanFile} isOcr={isOcr} />}</AnimatePresence>

      {/* Drag & drop overlay */}
      <AnimatePresence>
        {dragging && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none"
            style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(20px)' }}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }}
              className="flex flex-col items-center justify-center gap-4 w-80 h-64 rounded-3xl"
              style={{ border: '2px dashed rgba(255,255,255,0.2)' }}>
              <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}>
                <Upload size={48} className="text-white/30" />
              </motion.div>
              <p className="text-white/50 text-sm" style={{ fontWeight: 300 }}>Drop files or folders to index</p>
              <p className="text-white/25 text-xs">Supports PDF, DOCX, TXT, PNG, JPG</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Browser support warning */}
      {!supportsFS && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-20 liquid-glass rounded-2xl px-5 py-3 text-center">
          <p className="text-white/40 text-sm" style={{ fontWeight: 300 }}>
            Use <span className="text-white/70">Chrome</span> or <span className="text-white/70">Edge</span> for folder scanning.
          </p>
        </div>
      )}

      {/* Full Drive Setup modal */}
      <AnimatePresence>
        {showFullDriveSetup && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xl flex items-center justify-center p-4"
            onClick={() => setShowFullDriveSetup(false)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="liquid-glass-strong rounded-2xl p-8 max-w-lg w-full">
              <div className="flex items-center justify-between mb-6">
                <h2 className="font-heading text-xl text-white">Full Drive Scan Setup</h2>
                <button onClick={() => setShowFullDriveSetup(false)} className="text-white/30 hover:text-white/60 transition"><X size={18} /></button>
              </div>
              <div className="text-white/40 text-[13px] space-y-3 mb-6 leading-relaxed" style={{ fontWeight: 300 }}>
                <p className="text-white/60">To scan your entire Google Drive, you need your own Google Cloud credentials:</p>
                <ol className="list-decimal list-inside space-y-2 text-white/40">
                  <li>Go to <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer" className="text-white/60 underline underline-offset-2">Google Cloud Console</a></li>
                  <li>Create a new project</li>
                  <li>Enable <span className="text-white/60">Google Drive API</span></li>
                  <li>Create <span className="text-white/60">OAuth Client ID</span> (Web application)</li>
                  <li>Add your current URL to <span className="text-white/60">Authorized JavaScript Origins</span></li>
                  <li>Paste the Client ID below</li>
                </ol>
                <p className="text-white/25 text-[11px]">Your Client ID stays in your browser only.</p>
              </div>
              <div className="flex gap-3">
                <input type="text" value={userClientId} onChange={(e) => setUserClientId(e.target.value)}
                  placeholder="Paste your Client ID here"
                  className="flex-1 px-4 py-2.5 rounded-full bg-white/[0.06] border border-white/[0.1] text-white/80 text-[13px] placeholder-white/20 outline-none focus:border-white/25 transition" style={{ fontWeight: 300 }} />
                <button onClick={startFullDriveScanFromSetup}
                  className="px-6 py-2.5 rounded-full text-[13px] bg-white text-black hover:bg-white/90 transition-all" style={{ fontWeight: 500 }}>
                  Start
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat Panel */}
      <ChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        indexedCount={indexedCount}
        onSearchFile={(filename) => { setChatOpen(false); setQuery(filename); runSearch(filename) }}
      />
    </div>
    </>
  )
}

export default App
