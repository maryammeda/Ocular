import sqlite3
from datetime import datetime


class DocumentDB:
    def __init__(self, db_path="search_index.db"):
        try:
            self.conn = sqlite3.connect(db_path)
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
                SELECT filename, filepath, snippet(documents, 2, '<b>', '</b>', '...', 32), filetype
                FROM documents
                WHERE documents MATCH ?
                ORDER BY rank
                """,
                (query,),
            )
            return self.cursor.fetchall()
        except sqlite3.Error as e:
            print(f"Search error: {e}")
            return []

    def close(self):
        try:
            self.conn.close()
        except sqlite3.Error as e:
            print(f"Error closing database: {e}")
