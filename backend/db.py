import os
import re
import logging
import sqlite3
from datetime import datetime

log = logging.getLogger("ocular.db")

STOP_WORDS = {
    "what", "is", "the", "a", "an", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could", "should",
    "may", "might", "shall", "can", "need", "to", "of", "in", "for", "on", "with",
    "at", "by", "from", "up", "about", "into", "through", "before", "after", "out",
    "over", "under", "then", "when", "where", "why", "how", "all", "each", "every",
    "both", "more", "most", "other", "some", "such", "no", "not", "only", "same",
    "so", "than", "too", "i", "me", "my", "we", "our", "you", "your", "he", "his",
    "she", "her", "it", "its", "they", "them", "their", "this", "that", "these",
    "those", "who", "which", "and", "but", "or", "if", "as", "tell", "give", "me",
    "find", "show", "list", "explain", "describe", "get", "let", "just",
}


def _sanitize_fts_query(question: str) -> str:
    """Convert a natural language question into an FTS5 keyword OR query."""
    clean = re.sub(r"[^\w\s]", " ", question.lower())
    words = [w for w in clean.split() if w not in STOP_WORDS and len(w) > 2]
    if not words:
        # Fall back to treating the whole question as a phrase
        return f'"{question}"'
    # FTS5 OR query: match documents containing any of the key terms
    return " OR ".join(f'"{w}"' for w in words[:10])


class DocumentDB:
    def __init__(self, db_path="search_index.db"):
        try:
            self.conn = sqlite3.connect(db_path, check_same_thread=False)
            self.conn.execute("PRAGMA journal_mode=WAL")
            self.cursor = self.conn.cursor()
            self._create_tables()
        except sqlite3.Error as e:
            log.error("Database connection error: %s", e)
            raise

    def _create_tables(self):
        try:
            self.cursor.execute("""
                CREATE VIRTUAL TABLE IF NOT EXISTS documents
                USING fts5(filename, filepath, content, filetype, created_at)
            """)
            # Tracks each indexed file's mtime so re-scans skip unchanged files
            self.cursor.execute("""
                CREATE TABLE IF NOT EXISTS file_cache (
                    filepath TEXT PRIMARY KEY,
                    last_modified REAL NOT NULL
                )
            """)
            self.conn.commit()
        except sqlite3.Error as e:
            log.error("Table creation error: %s", e)
            raise

    # ------------------------------------------------------------------ #
    # File-change cache                                                    #
    # ------------------------------------------------------------------ #

    def is_indexed(self, filepath: str, mtime: float) -> bool:
        """Return True if this file is already indexed with the same mtime."""
        try:
            filepath = os.path.normpath(filepath)
            self.cursor.execute(
                "SELECT 1 FROM file_cache WHERE filepath = ? AND last_modified = ?",
                (filepath, mtime),
            )
            return self.cursor.fetchone() is not None
        except sqlite3.Error:
            return False

    def upsert_cache(self, filepath: str, mtime: float):
        """Record the mtime of a successfully indexed file."""
        self.upsert_cache_no_commit(filepath, mtime)
        self.conn.commit()

    def upsert_cache_no_commit(self, filepath: str, mtime: float):
        """Record mtime without committing (for batch writes)."""
        try:
            filepath = os.path.normpath(filepath)
            self.cursor.execute(
                "INSERT OR REPLACE INTO file_cache (filepath, last_modified) VALUES (?, ?)",
                (filepath, mtime),
            )
        except sqlite3.Error as e:
            log.error("Cache update error: %s", e)

    # ------------------------------------------------------------------ #
    # CRUD                                                                 #
    # ------------------------------------------------------------------ #

    def add_document(self, filename, filepath, content, filetype):
        self.add_document_no_commit(filename, filepath, content, filetype)
        self.conn.commit()

    def add_document_no_commit(self, filename, filepath, content, filetype):
        """Insert/replace a document without committing (for batch writes)."""
        try:
            filepath = os.path.normpath(filepath)
            self.cursor.execute(
                "DELETE FROM documents WHERE filepath = ?", (filepath,)
            )
            created_at = datetime.now().isoformat()
            self.cursor.execute(
                "INSERT INTO documents (filename, filepath, content, filetype, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (filename, filepath, content, filetype, created_at),
            )
        except sqlite3.Error as e:
            log.error("Insert error: %s", e)
            raise

    def delete_document(self, filepath: str):
        """Remove a document and its cache entry (called by the file watcher on delete)."""
        try:
            filepath = os.path.normpath(filepath)
            self.cursor.execute("DELETE FROM documents WHERE filepath = ?", (filepath,))
            self.cursor.execute("DELETE FROM file_cache WHERE filepath = ?", (filepath,))
            self.conn.commit()
        except sqlite3.Error as e:
            log.error("Delete error: %s", e)

    # ------------------------------------------------------------------ #
    # Search / retrieval                                                   #
    # ------------------------------------------------------------------ #

    def get_relevant_docs(self, query: str, limit: int = 8) -> list:
        """FTS5 search returning full content — used by the RAG pipeline."""
        try:
            fts_query = _sanitize_fts_query(query)
            self.cursor.execute(
                """
                SELECT filename, filepath, content, filetype
                FROM documents
                WHERE documents MATCH ?
                ORDER BY rank
                LIMIT ?
                """,
                (fts_query, limit),
            )
            rows = self.cursor.fetchall()
            return [
                {"filename": r[0], "filepath": r[1], "content": r[2], "filetype": r[3]}
                for r in rows
            ]
        except sqlite3.Error as e:
            log.error("Get relevant docs error for query %r: %s", query, e)
            return []

    def search(self, query):
        try:
            self.cursor.execute(
                """
                SELECT filename, filepath,
                       snippet(documents, 2, '<b>', '</b>', '...', 32),
                       filetype, content
                FROM documents
                WHERE documents MATCH ?
                ORDER BY rank
                """,
                (query,),
            )
            rows = self.cursor.fetchall()
            seen = {}
            for filename, filepath, snippet, filetype, content in rows:
                if filepath not in seen:
                    query_lower = query.lower()
                    count = content.lower().count(query_lower) if content else 0
                    seen[filepath] = (filename, filepath, snippet, filetype, max(count, 1))
            return list(seen.values())
        except sqlite3.Error as e:
            log.error("Search error: %s", e)
            return []

    def get_document(self, filepath):
        try:
            self.cursor.execute(
                "SELECT filename, filepath, content, filetype FROM documents WHERE filepath = ?",
                (filepath,),
            )
            return self.cursor.fetchone()
        except sqlite3.Error as e:
            log.error("Get document error: %s", e)
            return None

    def close(self):
        try:
            self.conn.close()
        except sqlite3.Error as e:
            log.error("Error closing database: %s", e)
