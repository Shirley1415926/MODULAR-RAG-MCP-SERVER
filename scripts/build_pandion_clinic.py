"""Rebuild the public synthetic ledger and versioned SQLite database (no API)."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.pandion_demo.clinic_dataset import write_assets, write_database

if __name__ == "__main__":
    write_assets(ROOT / "examples/pandion_demo")
    print(write_database(ROOT / "data/pandion_demo/pandion_clinic_v2.sqlite3"))
