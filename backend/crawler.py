import os
import logging
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

import pytesseract
from PIL import Image

from backend.db import DocumentDB

log = logging.getLogger("ocular.crawler")

IGNORED_DIRS = {".git", ".vscode", ".idea", "node_modules", "venv", "__pycache__", "AppData"}
MAX_PDF_PAGES = 50
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100 MB

# I/O-bound work (PDF/DOCX/TXT) can use many threads safely
IO_WORKERS = 8
# OCR is CPU-bound — limit to 2 concurrent processes to prevent overheating
OCR_WORKERS = 2


class FileCrawler:
    TEXT_EXTENSIONS = {".pdf", ".docx", ".txt"}
    IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg"}

    def __init__(self, root_directory, deep_scan=True):
        self.root_directory = root_directory
        self.deep_scan = deep_scan
        self.db = DocumentDB()
        self._db_lock = threading.Lock()
        self._pending_writes = []
        self._BATCH_SIZE = 20

    def crawl(self):
        files_to_process = []
        for dirpath, dirnames, filenames in os.walk(self.root_directory):
            dirnames[:] = [
                d for d in dirnames
                if not d.startswith(".") and d not in IGNORED_DIRS
            ]
            allowed = self.TEXT_EXTENSIONS | self.IMAGE_EXTENSIONS if self.deep_scan else self.TEXT_EXTENSIONS
            for filename in filenames:
                ext = os.path.splitext(filename)[1].lower()
                if ext in allowed:
                    files_to_process.append(os.path.join(dirpath, filename))

        total = len(files_to_process)
        if total == 0:
            log.info("No supported files found.")
            return []

        log.info("Found %d files to process...", total)

        # Split into text files (I/O-bound) and image files (CPU-bound)
        text_files = []
        image_files = []
        for fp in files_to_process:
            ext = os.path.splitext(fp)[1].lower()
            if ext in self.IMAGE_EXTENSIONS:
                image_files.append(fp)
            else:
                text_files.append(fp)

        documents = []
        done = 0

        # Phase 1: Process text files with high concurrency (fast, I/O-bound)
        if text_files:
            log.info("Phase 1: Indexing %d text files...", len(text_files))
            with ThreadPoolExecutor(max_workers=IO_WORKERS) as executor:
                futures = {executor.submit(self._process_file, fp): fp for fp in text_files}
                for future in as_completed(futures):
                    done += 1
                    result = future.result()
                    fp = futures[future]
                    filename = os.path.basename(fp)
                    if result is True:
                        pass
                    elif result:
                        documents.append(result)
                        log.info("[%d/%d] Indexed: %s", done, total, filename)
                    else:
                        log.debug("[%d/%d] Skipped: %s", done, total, filename)
            self._flush_writes()

        # Phase 2: Process images with low concurrency (slow, CPU-bound)
        if image_files:
            log.info("Phase 2: OCR on %d images (throttled)...", len(image_files))
            with ThreadPoolExecutor(max_workers=OCR_WORKERS) as executor:
                futures = {executor.submit(self._process_file, fp): fp for fp in image_files}
                for future in as_completed(futures):
                    done += 1
                    result = future.result()
                    fp = futures[future]
                    filename = os.path.basename(fp)
                    if result is True:
                        pass
                    elif result:
                        documents.append(result)
                        log.info("[%d/%d] Indexed: %s", done, total, filename)
                    else:
                        log.debug("[%d/%d] Skipped: %s", done, total, filename)
            self._flush_writes()

        log.info("Indexing complete. %d new/updated files indexed.", len(documents))
        return documents

    def _process_file(self, filepath):
        filename = os.path.basename(filepath)
        ext = os.path.splitext(filename)[1].lower()

        try:
            if os.path.getsize(filepath) > MAX_FILE_SIZE:
                log.info("Skipped (too large): %s", filename)
                return None
        except OSError:
            pass

        try:
            mtime = os.path.getmtime(filepath)
            with self._db_lock:
                if self.db.is_indexed(filepath, mtime):
                    return True
        except OSError:
            mtime = 0.0

        try:
            if ext == ".pdf":
                content = self._process_pdf(filepath)
                filetype = "document"
            elif ext == ".docx":
                content = self._process_docx(filepath)
                filetype = "document"
            elif ext == ".txt":
                content = self._process_txt(filepath)
                filetype = "document"
            elif ext in (".png", ".jpg", ".jpeg"):
                content = self._process_image(filepath)
                filetype = "image"
            else:
                return None

            if content:
                self._queue_write(filename, filepath, content, filetype, mtime)
                return {
                    "filename": filename,
                    "filepath": filepath,
                    "content": content,
                    "filetype": ext,
                }
        except Exception as e:
            log.error("Error processing %s: %s", filename, e)
        return None

    def _queue_write(self, filename, filepath, content, filetype, mtime):
        """Queue a DB write and flush in batches to reduce commit overhead."""
        with self._db_lock:
            self._pending_writes.append((filename, filepath, content, filetype, mtime))
            if len(self._pending_writes) >= self._BATCH_SIZE:
                self._flush_writes_unlocked()

    def _flush_writes(self):
        with self._db_lock:
            self._flush_writes_unlocked()

    def _flush_writes_unlocked(self):
        """Write all pending documents in a single transaction."""
        if not self._pending_writes:
            return
        try:
            for filename, filepath, content, filetype, mtime in self._pending_writes:
                self.db.add_document_no_commit(filename, filepath, content, filetype)
                self.db.upsert_cache_no_commit(filepath, mtime)
            self.db.conn.commit()
        except Exception as e:
            log.error("Batch write error: %s", e)
            try:
                self.db.conn.rollback()
            except Exception:
                pass
        self._pending_writes.clear()

    def _process_pdf(self, filepath):
        try:
            import fitz  # PyMuPDF — much faster than pdfplumber for text extraction
            doc = fitz.open(filepath)
            text = ""
            for page in doc[:MAX_PDF_PAGES]:
                text += page.get_text()
            doc.close()
            return text if text.strip() else None
        except Exception as e:
            log.error("PDF error (%s): %s", filepath, e)
            return None

    def _process_docx(self, filepath):
        try:
            import docx
            doc = docx.Document(filepath)
            text = "\n".join(para.text for para in doc.paragraphs)
            return text if text.strip() else None
        except Exception as e:
            log.error("DOCX error (%s): %s", filepath, e)
            return None

    def _process_txt(self, filepath):
        try:
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read()
            return text.strip() if text.strip() else None
        except Exception as e:
            log.error("TXT error (%s): %s", filepath, e)
            return None

    def _process_image(self, filepath):
        try:
            if os.path.getsize(filepath) < 30 * 1024:
                return None

            image = Image.open(filepath)

            # Downscale aggressively — OCR doesn't need high resolution
            if image.width > 800:
                ratio = 800 / image.width
                new_size = (800, int(image.height * ratio))
                image = image.resize(new_size, Image.BILINEAR)

            image = image.convert("L")

            text = pytesseract.image_to_string(image, timeout=30)
            text = text.replace("\n", " ").replace("\r", " ").strip()
            return text if text else None
        except Exception as e:
            log.error("Image OCR error (%s): %s", filepath, e)
            return None


if __name__ == "__main__":
    folder = input("Enter folder path to crawl: ")
    crawler = FileCrawler(folder)
    crawler.crawl()
