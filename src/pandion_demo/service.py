"""Retrieval and grounded generation for Pandion dashboard insights."""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

from src.core.query_engine.dense_retriever import create_dense_retriever
from src.core.query_engine.hybrid_search import create_hybrid_search
from src.core.query_engine.query_processor import QueryProcessor
from src.core.query_engine.sparse_retriever import create_sparse_retriever
from src.core.settings import Settings, resolve_path
from src.core.types import RetrievalResult
from src.ingestion.storage.bm25_indexer import BM25Indexer
from src.libs.embedding import EmbeddingFactory
from src.libs.llm import LLMFactory, Message
from src.libs.vector_store.vector_store_factory import VectorStoreFactory
from src.pandion_demo import COLLECTION_NAME
from src.pandion_demo.feedback_analytics import FeedbackAnalytics
from src.pandion_demo.clinic_knowledge import feedback_records

SCENARIO_QUERIES = {
    "kpi-revenue": "Explain a recent revenue decline using billing holds, completed appointments, cancellations, refunds and demand evidence.",
    "kpi-appointments": "Explain an appointments KPI change using cancellations, no-shows, reminder delivery and available appointment slots.",
    "kpi-patients": "Explain a new-patient KPI change using the metric definition, referral mix, first-visit cancellations and allocation constraints.",
    "kpi-utilisation": "Explain low clinician utilisation despite patient demand using capacity, appointment windows, specialty and modality mismatch.",
    "allocation-priority": "Explain the matching risk for a high-priority referral and identify hard constraints, clinician specialties, language and escalation policy.",
    "allocation-waiting": "Explain why patients remain on the waiting list using availability, evening capacity and patient constraints.",
    "allocation-followup": "Explain follow-up allocation risk involving continuity, timing requirements and clinician availability.",
    "feedback-overview": "Summarise recurring patient feedback themes with both positive and negative evidence and source records.",
    "feedback-cancellation": "Explain cancellation themes and recommend operational actions using cancellation notes and the cancellation SOP.",
    "feedback-noshow": "Explain no-show themes using outreach notes, reminder incidents and the no-show response playbook.",
    "feedback-booking": "Explain booking experience themes including ease of booking, rescheduling and appointment availability.",
}

logger = logging.getLogger(__name__)

SCENARIO_ROUTING = {
    "kpi-revenue": ({"operational_event", "policy"}, {"finance"}),
    "kpi-appointments": ({"operational_event", "cancellation_note", "no_show_note", "sop"}, {"attendance", "capacity"}),
    "kpi-patients": ({"policy", "referral_constraint", "cancellation_note", "operational_event"}, {"metrics", "allocation"}),
    "kpi-utilisation": ({"operational_event", "referral_constraint", "clinician_profile", "sop"}, {"capacity", "allocation"}),
    "allocation-priority": ({"referral_constraint", "clinician_profile", "sop", "operational_event"}, {"allocation"}),
    "allocation-waiting": ({"referral_constraint", "clinician_profile", "sop", "operational_event"}, {"allocation", "capacity"}),
    "allocation-followup": ({"referral_constraint", "clinician_profile", "sop"}, {"allocation"}),
    "feedback-overview": ({"patient_feedback", "sop"}, {"feedback"}),
    "feedback-cancellation": ({"cancellation_note", "patient_feedback", "sop"}, {"cancellation"}),
    "feedback-noshow": ({"no_show_note", "patient_feedback", "operational_event", "sop"}, {"attendance"}),
    "feedback-booking": ({"patient_feedback", "cancellation_note", "sop"}, {"feedback", "cancellation"}),
}


def parse_generation(content: str) -> dict[str, Any]:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip(), flags=re.IGNORECASE)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        if start < 0:
            raise
        data, _ = json.JSONDecoder().raw_decode(cleaned[start:])
    required = ("title", "summary", "signals", "recommendation")
    if any(key not in data for key in required) or not isinstance(data["signals"], list):
        raise ValueError("LLM response does not match the required insight schema")
    return data


class PandionRAGService:
    def __init__(self, settings: Settings, collection: str = COLLECTION_NAME) -> None:
        self.settings = settings
        self.collection = collection
        self.vector_store = VectorStoreFactory.create(settings, collection_name=collection)
        self.sparse_only = os.getenv("PANDION_SPARSE_ONLY", "").strip().lower() in {
            "1", "true", "yes", "on",
        }
        self.embedding = None
        dense = None
        if not self.sparse_only:
            self.embedding = EmbeddingFactory.create(settings)
            dense = create_dense_retriever(
                settings=settings,
                embedding_client=self.embedding,
                vector_store=self.vector_store,
            )
        bm25 = BM25Indexer(index_dir=str(resolve_path(f"data/db/bm25/{collection}")))
        sparse = create_sparse_retriever(settings=settings, bm25_indexer=bm25, vector_store=self.vector_store)
        sparse.default_collection = collection
        self.hybrid_search = create_hybrid_search(
            settings=settings,
            query_processor=QueryProcessor(),
            dense_retriever=dense,
            sparse_retriever=sparse,
        )
        self.llm = LLMFactory.create(settings)
        self.feedback_analytics = FeedbackAnalytics(records=feedback_records())

    def collection_stats(self) -> dict[str, Any]:
        return self.vector_store.get_collection_stats()

    def answer(
        self,
        scenario: str,
        context: str = "",
        metrics: dict[str, Any] | None = None,
        filters: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if scenario not in SCENARIO_QUERIES:
            raise ValueError(f"Unknown scenario: {scenario}")
        if scenario == "feedback-overview":
            return self._answer_feedback_overview(filters or {})
        query = SCENARIO_QUERIES[scenario]
        if context:
            query += f" Dashboard context: {context[:800]}"
        if metrics:
            query += f" Current synthetic metrics: {json.dumps(metrics, ensure_ascii=False)[:800]}"

        results = self._retrieve_scenario_evidence(scenario, query, top_k=6)
        if not results:
            raise RuntimeError("No evidence was retrieved. Run the Pandion setup script first.")

        evidence_text = "\n".join(
            f"[{i}] {item.metadata.get('record_id', item.chunk_id)} | "
            f"{item.metadata.get('record_type', 'record')} | {item.metadata.get('date', '')} | {item.text}"
            for i, item in enumerate(results, start=1)
        )
        messages = [
            Message(role="system", content=(
                "You are an operations analyst for a fictional healthcare dashboard. Use only the retrieved evidence. "
                "Do not invent counts, causes, policies or patient facts. Clearly use cautious language when evidence is suggestive. "
                "Return JSON only with keys title, summary, signals (exactly 3 short strings), and recommendation."
            )),
            Message(role="user", content=f"Question:\n{query}\n\nRetrieved evidence:\n{evidence_text}"),
        ]
        generation_mode = "deepseek"
        model = getattr(self.settings.llm, "model", "unknown")
        try:
            response = self.llm.chat(messages, temperature=0.1, max_tokens=700)
            generated = parse_generation(response.content)
            model = response.model
        except Exception as exc:
            logger.warning("DeepSeek synthesis failed; using extractive fallback: %s", exc)
            generation_mode = "extractive_fallback"
            generated = {
                "title": "Retrieved operational evidence",
                "summary": "The knowledge base returned relevant records, but generative synthesis was unavailable. Review the evidence below before taking action.",
                "signals": [item.text[:180] for item in results[:3]],
                "recommendation": "Follow the cited SOP and validate the dashboard metric against the source systems.",
            }

        top_score = max(float(item.score) for item in results) or 1.0
        relative_strength = sum(float(item.score) / top_score for item in results[:3]) / min(3, len(results))
        strength = max(60, min(96, round(60 + relative_strength * 36)))
        evidence = [self._evidence_item(item) for item in results]
        sop = next((item.metadata.get("title") for item in results if item.metadata.get("record_type") in {"sop", "policy"}), "retrieved operational records")
        return {
            "scenario": scenario,
            "eyebrow": "Live grounded insight",
            "title": generated["title"],
            "summary": generated["summary"],
            "signals": generated["signals"][:3],
            "recommendation": generated["recommendation"],
            "sop": sop,
            "confidence": strength,
            "evidence": evidence,
            "retrieval_method": (
                "BM25 evidence retrieval"
                if self.sparse_only
                else "Ollama embeddings + BM25 + RRF"
            ),
            "collection": self.collection,
            "generation_mode": generation_mode,
            "model": model,
        }

    def _retrieve_scenario_evidence(self, scenario: str, query: str, top_k: int) -> list[RetrievalResult]:
        """Route dense and sparse candidates before RRF so noise cannot crowd out a scenario."""
        details = self.hybrid_search.search(query=query, top_k=20, filters=None, return_details=True)
        dense = self._route_results(scenario, details.dense_results or [])
        sparse = self._route_results(scenario, details.sparse_results or [])
        if dense and sparse and self.hybrid_search.fusion is not None:
            return self.hybrid_search.fusion.fuse([dense, sparse], top_k=top_k)
        return (dense or sparse or details.results)[:top_k]

    def _answer_feedback_overview(self, filters: dict[str, Any]) -> dict[str, Any]:
        """Aggregate all filtered feedback before asking the LLM to explain it."""
        analytics = self.feedback_analytics.analyse(filters)
        # All theme counts are used; representative quotes are not frequency estimates.
        top_themes = analytics["themes"]
        representative_records = [
            theme["representative_records"][0]
            for theme in top_themes
            if theme["representative_records"]
        ]

        policy_candidates = self.hybrid_search.search(
            query="Patient feedback review SOP: theme grouping, source evidence, privacy and analyst inference.",
            top_k=12,
            filters=None,
        )
        policy_results = [
            item for item in policy_candidates
            if item.metadata.get("record_type") in {"sop", "policy"}
            and item.metadata.get("section") == "feedback"
        ][:1]

        evidence = [self._feedback_evidence_item(row) for row in representative_records]
        evidence.extend(self._evidence_item(item) for item in policy_results)

        if analytics["insufficient_evidence"]:
            return {
                "scenario": "feedback-overview",
                "eyebrow": "Insufficient evidence",
                "title": "Not enough filtered feedback to form a reliable theme conclusion",
                "summary": (
                    f"Only {analytics['total_feedback']} feedback records matched the structured filters. "
                    f"At least {analytics['minimum_sample']} are required before themes are reported."
                ),
                "signals": [
                    f"Verified date range: {analytics['start_date']} to {analytics['end_date']}.",
                    "No theme ranking has been inferred from the small sample.",
                    "Broaden the filters or wait for more feedback before acting.",
                ],
                "recommendation": "Broaden the date range or collect more feedback, then run the analysis again.",
                "sop": "Patient feedback review",
                "confidence": 0,
                "evidence": evidence,
                "analytics": self._public_analytics(analytics),
                "retrieval_method": "Structured filtering + full-set aggregation + SOP retrieval",
                "collection": self.collection,
                "generation_mode": "rules_only",
                "model": "not_called",
            }

        prompt_stats = [{
            "theme": theme["label"],
            "count": theme["count"],
            "share_percent": theme["share"],
            "sentiments": theme["sentiments"],
            "source_ids": theme["representative_sources"],
        } for theme in top_themes]
        evidence_text = "\n".join(
            f"[{index}] {item['source']} | {item['meta']} | {item['quote']}"
            for index, item in enumerate(evidence, start=1)
        )
        messages = [
            Message(role="system", content=(
                "You are an operations analyst for a healthcare dashboard prototype. The statistics were computed "
                "deterministically across every feedback row that passed structured filters. Use only those statistics "
                "and the cited evidence. Do not recalculate, invent, or imply access to real patient data. Return JSON "
                "only with keys title, summary, signals (exactly 3 short strings), and recommendation. State the sample "
                "size and distinguish direct feedback from operational interpretation."
            )),
            Message(role="user", content=(
                f"Verified range: {analytics['start_date']} to {analytics['end_date']}\n"
                f"All matching feedback rows analysed: {analytics['total_feedback']}\n"
                f"Top theme statistics: {json.dumps(prompt_stats, ensure_ascii=False)}\n\n"
                f"Representative feedback and retrieved SOP evidence:\n{evidence_text}"
            )),
        ]
        generation_mode = "deepseek"
        model = getattr(self.settings.llm, "model", "unknown")
        try:
            response = self.llm.chat(messages, temperature=0.1, max_tokens=700)
            generated = parse_generation(response.content)
            model = response.model
        except Exception as exc:
            logger.warning("DeepSeek feedback synthesis failed; using deterministic fallback: %s", exc)
            generation_mode = "deterministic_fallback"
            leader = top_themes[0]
            generated = {
                "title": f"{leader['label']} is the most frequent feedback theme",
                "summary": (
                    f"All {analytics['total_feedback']} feedback records in the verified date range were analysed. "
                    f"{leader['label']} appeared in {leader['count']} records ({leader['share']}%)."
                ),
                "signals": [
                    f"{theme['label']}: {theme['count']} records ({theme['share']}%)."
                    for theme in top_themes
                ],
                "recommendation": "Review the representative comments and apply the cited feedback-review SOP before changing operations.",
            }

        return {
            "scenario": "feedback-overview",
            "eyebrow": "Verified full-set feedback insight",
            "title": generated["title"],
            "summary": generated["summary"],
            "signals": generated["signals"][:3],
            "recommendation": generated["recommendation"],
            "sop": policy_results[0].metadata.get("title", "Patient feedback review") if policy_results else "Patient feedback review",
            "confidence": min(96, 70 + min(26, analytics["total_feedback"])),
            "evidence": evidence,
            "analytics": self._public_analytics(analytics),
            "retrieval_method": "Structured filtering + full-set aggregation + SOP retrieval",
            "collection": self.collection,
            "generation_mode": generation_mode,
            "model": model,
        }

    @staticmethod
    def _public_analytics(analytics: dict[str, Any]) -> dict[str, Any]:
        return {
            "total_feedback": analytics["total_feedback"],
            "available_feedback": analytics["available_feedback"],
            "minimum_sample": analytics["minimum_sample"],
            "insufficient_evidence": analytics["insufficient_evidence"],
            "start_date": analytics["start_date"],
            "end_date": analytics["end_date"],
            "applied_filters": analytics["applied_filters"],
            "themes": [{key: value for key, value in theme.items() if key != "representative_records"}
                       for theme in analytics["themes"]],
        }

    @staticmethod
    def _feedback_evidence_item(record: dict[str, Any]) -> dict[str, Any]:
        return {
            "source": record["record_id"],
            "meta": " · ".join(["patient_feedback", record["date"], record["title"]]),
            "quote": record["text"],
            "score": 1.0,
            "chunk_id": record["record_id"],
        }

    @staticmethod
    def _route_results(scenario: str, candidates: list[RetrievalResult]) -> list[RetrievalResult]:
        record_types, sections = SCENARIO_ROUTING[scenario]

        def relevance(item: RetrievalResult) -> tuple[int, float]:
            meta = item.metadata
            record_type = meta.get("record_type")
            section = meta.get("section")
            theme = meta.get("theme")
            type_match = record_type in record_types
            topic_match = section in sections or theme in sections
            # Notes, feedback, referrals and profiles are intrinsically scoped by type;
            # broad SOP/event/policy records must also match the scenario topic.
            broad = record_type in {"sop", "policy", "operational_event"}
            accepted = type_match and (topic_match or not broad)
            return (1 if accepted else 0, float(item.score))

        ranked = sorted(candidates, key=relevance, reverse=True)
        routed = [item for item in ranked if relevance(item)[0] == 1]
        return routed or candidates

    @staticmethod
    def _evidence_item(result: RetrievalResult) -> dict[str, Any]:
        metadata = result.metadata
        return {
            "source": metadata.get("record_id", result.chunk_id),
            "meta": " · ".join(filter(None, [metadata.get("record_type"), metadata.get("date"), metadata.get("title")])),
            "quote": result.text,
            "score": round(float(result.score), 6),
            "chunk_id": result.chunk_id,
        }
