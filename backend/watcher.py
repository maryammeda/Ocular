import os
import time
import threading
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

from backend.crawler import FileCrawler
from backend.db import DocumentDB

SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".txt", ".png", ".jpg", ".jpeg"}
IGNORED_DIRS = {".git", ".vscode", ".idea", "node_modules", "venv", "__pycache__", "AppData"}


def _in_ignored_dir(filepath):
    parts = filepath.replace("\\", "/").split("/")
    return any(p in IGNORED_DIRS for p in parts)


class _IndexHandler(FileSystemEventHandler):
    """Re-indexes a file whenever it is created or modified, removes it on delete."""

    def __init__(self):
        self._debounce = {}
        self._lock = threading.Lock()

    def _should_handle(self, path):
        if _in_ignored_dir(path):
            return False
        ext = os.path.splitext(path)[1].lower()
        return ext in SUPPORTED_EXTENSIONS

    def _reindex(self, filepath):
        """Process a single file and upsert it into the index."""
        filepath = os.path.normpath(filepath)
        if not os.path.isfile(filepath):
            return
        filename = os.path.basename(filepath)
        ext = os.path.splitext(filename)[1].lower()
        crawler = FileCrawler.__new__(FileCrawler)
        crawler.db = DocumentDB()
        crawler._db_lock = threading.Lock()
        crawler.deep_scan = True
        result = crawler._process_file(filepath)
        if result:
            print(f"[watcher] Re-indexed: {filename}")
        else:
            print(f"[watcher] Skipped: {filename}")

    def _handle_event(self, filepath):
        """Debounce rapid events on the same file (e.g. save triggers multiple writes)."""
        with self._lock:
            now = time.time()
            last = self._debounce.get(filepath, 0)
            if now - last < 2:
                return
            self._debounce[filepath] = now

        try:
            self._reindex(filepath)
        except Exception as e:
            print(f"[watcher] Error re-indexing {filepath}: {e}")

    def on_created(self, event):
        if not event.is_directory and self._should_handle(event.src_path):
            self._handle_event(event.src_path)

    def on_modified(self, event):
        if not event.is_directory and self._should_handle(event.src_path):
            self._handle_event(event.src_path)

    def on_deleted(self, event):
        if not event.is_directory and self._should_handle(event.src_path):
            filepath = os.path.normpath(event.src_path)
            try:
                db = DocumentDB()
                db.delete_document(filepath)  # removes from documents + file_cache
                db.close()
                print(f"[watcher] Removed from index: {os.path.basename(filepath)}")
            except Exception as e:
                print(f"[watcher] Error removing {filepath}: {e}")


class FileWatcher:
    """Watches directories for file changes and auto-reindexes."""

    def __init__(self):
        self._observer = Observer()
        self._handler = _IndexHandler()
        self._watched = {}  # path -> watch object

    def watch(self, path):
        path = os.path.normpath(path)
        if path in self._watched:
            return False  # already watching
        watch = self._observer.schedule(self._handler, path, recursive=True)
        self._watched[path] = watch
        print(f"[watcher] Now watching: {path}")
        return True

    def unwatch(self, path):
        path = os.path.normpath(path)
        watch = self._watched.pop(path, None)
        if watch:
            self._observer.unschedule(watch)
            print(f"[watcher] Stopped watching: {path}")
            return True
        return False

    def get_watched(self):
        return list(self._watched.keys())

    def start(self):
        if not self._observer.is_alive():
            self._observer.start()
            print("[watcher] File watcher started")

    def stop(self):
        self._observer.stop()
        self._observer.join()
        print("[watcher] File watcher stopped")
