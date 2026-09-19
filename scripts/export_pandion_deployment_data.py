"""Export only the synthetic Pandion retrieval data needed by the cloud demo."""

from __future__ import annotations

import shutil
from pathlib import Path

import chromadb


ROOT = Path(__file__).resolve().parents[1]
SOURCE_CHROMA = ROOT / "data" / "db" / "chroma"
SOURCE_BM25 = ROOT / "data" / "db" / "bm25" / "pandion_demo" / "pandion_demo_bm25.json"
DESTINATION = ROOT / "deployment" / "pandion_data"


def export() -> None:
    destination_chroma = DESTINATION / "chroma"
    destination_bm25 = DESTINATION / "bm25"
    if destination_chroma.exists():
        shutil.rmtree(destination_chroma)
    destination_bm25.mkdir(parents=True, exist_ok=True)

    source = chromadb.PersistentClient(path=str(SOURCE_CHROMA))
    source_collection = source.get_collection("pandion_demo")
    payload = source_collection.get(include=["documents", "embeddings", "metadatas"])

    target = chromadb.PersistentClient(path=str(destination_chroma))
    target_collection = target.get_or_create_collection(
        "pandion_demo",
        metadata={"hnsw:space": "cosine"},
    )
    target_collection.add(
        ids=payload["ids"],
        documents=payload["documents"],
        embeddings=payload["embeddings"],
        metadatas=payload["metadatas"],
    )
    shutil.copy2(SOURCE_BM25, destination_bm25 / SOURCE_BM25.name)
    print(f"Exported {target_collection.count()} synthetic Pandion records to {DESTINATION}")


if __name__ == "__main__":
    export()
