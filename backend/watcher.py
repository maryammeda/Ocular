import os
import logging
import time
import threading
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

from backend.crawler import FileCrawler
from backend.db import DocumentDB

log = logging.getLogger("ocular.watcher")

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
            log.info("Re-indexed: %s", filename)
        else:
            log.debug("Skipped: %s", filename)

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
            log.error("Error re-indexing %s: %s", filepath, e)

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
                log.info("Removed from index: %s", os.path.basename(filepath))
            except Exception as e:
                log.error("Error removing %s: %s", filepath, e)


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
        log.info("Now watching: %s", path)
        return True

    def unwatch(self, path):
        path = os.path.normpath(path)
        watch = self._watched.pop(path, None)
        if watch:
            self._observer.unschedule(watch)
            log.info("Stopped watching: %s", path)
            return True
        return False

    def get_watched(self):
        return list(self._watched.keys())

    def start(self):
        if not self._observer.is_alive():
            self._observer.start()
            log.info("File watcher started")

    def stop(self):
        self._observer.stop()
        self._observer.join()
        log.info("File watcher stopped")
