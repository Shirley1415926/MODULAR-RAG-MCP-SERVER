"""Ingestion adapter for the Pandion synthetic JSONL corpus."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from src.core.settings import Settings, resolve_path
from src.core.types import Chunk
from src.ingestion.embedding.dense_encoder import DenseEncoder
from src.ingestion.embedding.sparse_encoder import SparseEncoder
from src.ingestion.storage.bm25_indexer import BM25Indexer
from src.ingestion.storage.vector_upserter import VectorUpserter
from src.libs.embedding import EmbeddingFactory
from src.pandion_demo import COLLECTION_NAME
from src.pandion_demo.sample_data import build_records, write_dataset


def ingest_demo_data(settings: Settings, collection: str = COLLECTION_NAME, reset: bool = True) -> dict[str, Any]:
    records = build_records()
    dataset_path = write_dataset(resolve_path("data/pandion_demo/source_documents.jsonl"))
    chunks = []
    for index, record in enumerate(records):
        source_path = f"pandion://{record['record_type']}/{record['record_id']}"
        metadata = {key: value for key, value in record.items() if key != "text"}
        metadata.update({"source_path": source_path, "chunk_index": index, "doc_type": record["record_type"]})
        chunks.append(Chunk(id=record["record_id"], text=record["text"], metadata=metadata))

    embedding = EmbeddingFactory.create(settings)
    vectors = DenseEncoder(embedding=embedding, batch_size=16).encode(chunks)
    upserter = VectorUpserter(settings, collection_name=collection)
    if reset:
        upserter.vector_store.clear(collection)
    chunk_ids = upserter.upsert(chunks, vectors)

    for chunk, chunk_id in zip(chunks, chunk_ids):
        chunk.id = chunk_id
    term_stats = SparseEncoder(min_term_length=1).encode(chunks)
    bm25_dir = resolve_path(f"data/db/bm25/{collection}")
    BM25Indexer(index_dir=str(bm25_dir)).build(term_stats, collection=collection)

    return {
        "collection": collection,
        "records": len(records),
        "vector_dimensions": len(vectors[0]),
        "dataset_path": str(Path(dataset_path).resolve()),
        "bm25_index": str(Path(bm25_dir, f"{collection}_bm25.json").resolve()),
    }
