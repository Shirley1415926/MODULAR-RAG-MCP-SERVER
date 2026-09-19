"""Generate and ingest the fictional Pandion dataset."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.core.settings import load_settings
from src.pandion_demo.ingest import ingest_demo_data
from src.pandion_demo.operational_data import (
    write_browser_dashboard_payload,
    write_operational_database,
    write_public_dashboard_payload,
)

if __name__ == "__main__":
    stats = ingest_demo_data(load_settings(), reset=True)
    operations = write_operational_database("data/pandion_demo/pandion_clinic_v2.sqlite3")
    public_payload = write_public_dashboard_payload("examples/pandion_demo/synthetic_operations.json")
    browser_payload = write_browser_dashboard_payload("examples/pandion_demo/synthetic_operations.js")
    print("Pandion RAG dataset is ready:")
    for key, value in stats.items():
        print(f"  {key}: {value}")
    print("Synthetic operations database is ready:")
    for key, value in operations.items():
        print(f"  {key}: {value}")
    print(f"  public_dashboard_payload: {public_payload.resolve()}")
    print(f"  browser_dashboard_payload: {browser_payload.resolve()}")
