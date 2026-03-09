import os
import streamlit as st
from PIL import Image

from backend.db import DocumentDB
from backend.crawler import FileCrawler


def add_custom_css():
    st.markdown("""
    <style>
    /* 1. The Moving Nebula Background */
    .stApp {
        background: linear-gradient(-45deg, #0f0c29, #302b63, #24243e, #141E30);
        background-size: 400% 400%;
        animation: gradient 15s ease infinite;
    }
    @keyframes gradient {
        0% {background-position: 0% 50%;}
        50% {background-position: 100% 50%;}
        100% {background-position: 0% 50%;}
    }

    /* 2. Glassmorphism for Inputs and Containers */
    .stTextInput > div > div > input {
        background-color: rgba(255, 255, 255, 0.1);
        color: white;
        border: 1px solid rgba(255, 255, 255, 0.2);
        backdrop-filter: blur(10px);
        border-radius: 10px;
    }

    /* 3. Result Cards Styling */
    div[data-testid="stVerticalBlock"] > div {
        background-color: rgba(255, 255, 255, 0.05);
        border-radius: 15px;
        padding: 20px;
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        margin-bottom: 10px;
        transition: transform 0.3s ease;
    }
    div[data-testid="stVerticalBlock"] > div:hover {
        transform: scale(1.02);
        background-color: rgba(255, 255, 255, 0.1);
    }

    /* 4. Text Colors */
    h1, h2, h3, p, label {
        color: #e0e0e0 !important;
        font-family: 'Segoe UI', sans-serif;
    }
    </style>
    """, unsafe_allow_html=True)


# Page config
st.set_page_config(page_title="Neural Search", layout="wide")

# Apply custom CSS
add_custom_css()

# Title
st.title("Neural Search // Second Brain")

# Search
query = st.text_input("Search your knowledge base...")

if query:
    db = DocumentDB()
    results = db.search(query)

    if results:
        for filename, filepath, snippet, filetype in results:
            with st.container():
                st.subheader(filename)
                st.caption(filepath)
                if filetype == "image":
                    img = Image.open(filepath)
                    st.image(img, caption=filename)
                else:
                    st.markdown(snippet, unsafe_allow_html=True)
    else:
        st.info("No results found.")
    db.close()

# Sidebar
with st.sidebar:
    st.header("Index New Data")
    scan_mode = st.radio("Scan Mode", ["Quick Text Only", "Deep Scan (OCR)", "Custom Path"])

    if scan_mode == "Custom Path":
        custom_path = st.text_input("Folder Path")
        if st.button("Start Indexing"):
            if custom_path and os.path.isdir(custom_path):
                with st.spinner("Indexing..."):
                    crawler = FileCrawler(custom_path, deep_scan=False)
                    crawler.crawl()
                st.success("Indexing complete!")
            else:
                st.warning("Please enter a valid folder path.")
    else:
        deep_scan = scan_mode == "Deep Scan (OCR)"
        if st.button("Scan My Brain"):
            home = os.path.expanduser("~")
            folders = ["Desktop", "Downloads", "Documents"]
            progress = st.progress(0)
            for i, folder in enumerate(folders):
                folder_path = os.path.join(home, folder)
                if os.path.isdir(folder_path):
                    st.text(f"Scanning {folder}...")
                    crawler = FileCrawler(folder_path, deep_scan=deep_scan)
                    crawler.crawl()
                else:
                    st.warning(f"{folder} not found, skipping.")
                progress.progress((i + 1) / len(folders))
            st.success("Indexing complete!")
