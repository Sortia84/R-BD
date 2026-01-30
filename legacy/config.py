# config.py — Configuration pour R#SCD
import os
from pathlib import Path

# Paths
BASE_DIR = Path(__file__).parent
UPLOAD_DIR = BASE_DIR / "uploads"
DATA_DIR = BASE_DIR / "data"
LOGO_PATH = BASE_DIR / "assets" / "RCONTROLE.png"

# Create directories if they don't exist
UPLOAD_DIR.mkdir(exist_ok=True)
DATA_DIR.mkdir(exist_ok=True)
(BASE_DIR / "assets").mkdir(exist_ok=True)

# Application configuration
APP_NAME = "R#BD"
APP_VERSION = "1.0.0"