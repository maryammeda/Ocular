import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

import pdfplumber
import docx
import pytesseract
from PIL import Image

from backend.db import DocumentDB

IGNORED_DIRS = {".git", ".vscode", ".idea", "node_modules", "venv", "__pycache__", "AppData"}
MAX_WORKERS = 12       # I/O-bound file extraction benefits from more threads
MAX_PDF_PAGES = 50     # Cap to avoid spending minutes on 500-page textbooks


class FileCrawler:
    TEXT_EXTENSIONS = {".pdf", ".docx", ".txt"}
    IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg"}

    def __init__(self, root_directory, deep_scan=True):
        self.root_directory = root_directory
        self.deep_scan = deep_scan
        self.db = DocumentDB()
        self._db_lock = threading.Lock()

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
            print("No supported files found.")
            return []

        print(f"Found {total} files to process...")
        documents = []
        done = 0

        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            futures = {
                executor.submit(self._process_file, fp): fp
                for fp in files_to_process
            }
            for future in as_completed(futures):
                done += 1
                result = future.result()
                fp = futures[future]
                filename = os.path.basename(fp)
                if result is True:
                    # File already indexed and unchanged — silently skip
                    pass
                elif result:
                    documents.append(result)
                    print(f"[{done}/{total}] Indexed: {filename}", flush=True)
                else:
                    print(f"[{done}/{total}] Skipped: {filename}", flush=True)

        print(f"Indexing complete. {len(documents)} new/updated files indexed.")
        return documents

    def _process_file(self, filepath):
        filename = os.path.basename(filepath)
        ext = os.path.splitext(filename)[1].lower()

        # Skip files that haven't changed since the last scan
        try:
            mtime = os.path.getmtime(filepath)
            with self._db_lock:
                if self.db.is_indexed(filepath, mtime):
                    return True  # unchanged — nothing to do
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
                with self._db_lock:
                    self.db.add_document(filename, filepath, content, filetype)
                    self.db.upsert_cache(filepath, mtime)
                return {
                    "filename": filename,
                    "filepath": filepath,
                    "content": content,
                    "filetype": ext,
                }
        except Exception as e:
            print(f"Error processing {filename}: {e}")
        return None

    def _process_pdf(self, filepath):
        try:
            with pdfplumber.open(filepath) as pdf:
                text = ""
                for page in pdf.pages[:MAX_PDF_PAGES]:
                    page_text = page.extract_text()
                    if page_text:
                        text += page_text
                return text if text else None
        except Exception as e:
            print(f"PDF error ({filepath}): {e}")
            return None

    def _process_docx(self, filepath):
        try:
            doc = docx.Document(filepath)
            text = "\n".join(para.text for para in doc.paragraphs)
            return text if text.strip() else None
        except Exception as e:
            print(f"DOCX error ({filepath}): {e}")
            return None

    def _process_txt(self, filepath):
        try:
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read()
            return text.strip() if text.strip() else None
        except Exception as e:
            print(f"TXT error ({filepath}): {e}")
            return None

    def _process_image(self, filepath):
        try:
            if os.path.getsize(filepath) < 30 * 1024:
                return None

            image = Image.open(filepath)

            if image.width > 1000:
                ratio = 1000 / image.width
                new_size = (1000, int(image.height * ratio))
                image = image.resize(new_size, Image.LANCZOS)

            image = image.convert("L")

            text = pytesseract.image_to_string(image)
            text = text.replace("\n", " ").replace("\r", " ").strip()
            return text if text else None
        except Exception as e:
            print(f"Image OCR error ({filepath}): {e}")
            return None


if __name__ == "__main__":
    folder = input("Enter folder path to crawl: ")
    crawler = FileCrawler(folder)
    crawler.crawl()
