import os
import sqlite3
from datetime import datetime


class DocumentDB:
    def __init__(self, db_path="search_index.db"):
        try:
            self.conn = sqlite3.connect(db_path, check_same_thread=False)
            self.conn.execute("PRAGMA journal_mode=WAL")
            self.cursor = self.conn.cursor()
            self._create_table()
        except sqlite3.Error as e:
            print(f"Database connection error: {e}")
            raise

    def _create_table(self):
        try:
            self.cursor.execute("""
                CREATE VIRTUAL TABLE IF NOT EXISTS documents
                USING fts5(filename, filepath, content, filetype, created_at)
            """)
            self.conn.commit()
        except sqlite3.Error as e:
            print(f"Table creation error: {e}")
            raise

    def add_document(self, filename, filepath, content, filetype):
        try:
            filepath = os.path.normpath(filepath)
            # Remove existing entry so rescans don't create duplicates
            self.cursor.execute(
                "DELETE FROM documents WHERE filepath = ?", (filepath,)
            )
            created_at = datetime.now().isoformat()
            self.cursor.execute(
                "INSERT INTO documents (filename, filepath, content, filetype, created_at) VALUES (?, ?, ?, ?, ?)",
                (filename, filepath, content, filetype, created_at),
            )
            self.conn.commit()
        except sqlite3.Error as e:
            print(f"Insert error: {e}")
            raise

    def search(self, query):
        try:
            self.cursor.execute(
                """
                SELECT filename, filepath, snippet(documents, 2, '<b>', '</b>', '...', 32), filetype, content
                FROM documents
                WHERE documents MATCH ?
                ORDER BY rank
                """,
                (query,),
            )
            rows = self.cursor.fetchall()
            # Deduplicate by filepath and count keyword occurrences
            seen = {}
            for filename, filepath, snippet, filetype, content in rows:
                if filepath not in seen:
                    query_lower = query.lower()
                    count = content.lower().count(query_lower) if content else 0
                    seen[filepath] = (filename, filepath, snippet, filetype, max(count, 1))
            return list(seen.values())
        except sqlite3.Error as e:
            print(f"Search error: {e}")
            return []

    def get_document(self, filepath):
        try:
            self.cursor.execute(
                "SELECT filename, filepath, content, filetype FROM documents WHERE filepath = ?",
                (filepath,),
            )
            return self.cursor.fetchone()
        except sqlite3.Error as e:
            print(f"Get document error: {e}")
            return None

    def close(self):
        try:
            self.conn.close()
        except sqlite3.Error as e:
            print(f"Error closing database: {e}")
