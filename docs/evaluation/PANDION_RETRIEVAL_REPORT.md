# Pandion Retrieval Evaluation Report

- Golden questions: 20
- Metric cutoff: Top 5
- Pipeline: record type filtering before RRF fusion
- Dataset: synthetic patient and operational records

| Method | Hit Rate@5 | MRR@5 | Mean latency | P95 latency |
| --- | ---: | ---: | ---: | ---: |
| dense | 100% | 0.883 | 77.53 ms | 77.12 ms |
| bm25 | 85% | 0.825 | 4.02 ms | 4.32 ms |
| hybrid (route after RRF) | 95% | 0.850 | 72.77 ms | 79.72 ms |
| hybrid (route before RRF) | 100% | 0.896 | 77.54 ms | 77.13 ms |

## Interpretation

The benchmark intentionally mixes keyword-heavy questions and semantic paraphrases. BM25 misses some paraphrases, while dense retrieval sometimes ranks the correct record lower. Scenario routing before RRF lets hybrid retrieval find all labelled evidence within Top 5 and produces the strongest MRR in this run.

Latency is measured locally. Hybrid latency assumes dense and BM25 run in parallel and therefore uses the slower branch plus fusion time; it is not a production SLA.

## Per-case ranks

| ID | Dense | BM25 | Raw Hybrid | Routed Hybrid | Expected |
| --- | ---: | ---: | ---: | ---: | --- |
| RET-001 | 1 | 1 | 1 | 1 | SOP-001 |
| RET-002 | 1 | 1 | 1 | 1 | SOP-002 |
| RET-003 | 3 | miss | 3 | 4 | SOP-003 |
| RET-004 | 1 | 1 | 1 | 1 | SOP-004 |
| RET-005 | 3 | 2 | 3 | 3 | SOP-005 |
| RET-006 | 1 | 1 | 1 | 1 | SOP-006 |
| RET-007 | 1 | 1 | 1 | 1 | EVT-103, POL-001 |
| RET-008 | 1 | 1 | 1 | 1 | POL-002 |
| RET-009 | 1 | miss | 1 | 1 | EVT-101 |
| RET-010 | 1 | 1 | miss | 1 | EVT-102 |
| RET-011 | 2 | miss | 3 | 3 | EVT-103 |
| RET-012 | 1 | 1 | 1 | 1 | EVT-104 |
| RET-013 | 1 | 1 | 1 | 1 | REF-501 |
| RET-014 | 1 | 1 | 1 | 1 | REF-502 |
| RET-015 | 1 | 1 | 1 | 1 | REF-503 |
| RET-016 | 1 | 1 | 1 | 1 | CLN-601 |
| RET-017 | 2 | 1 | 1 | 1 | CLN-602 |
| RET-018 | 1 | 1 | 1 | 1 | CLN-603 |
| RET-019 | 1 | 1 | 1 | 1 | NS-402 |
| RET-020 | 1 | 1 | 1 | 1 | CAN-303 |
