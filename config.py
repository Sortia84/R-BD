# config.py - Configuration R#BD
"""
Configuration centralisée pour R#BD.
"""

from pathlib import Path

# Répertoires
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
UPLOADS_DIR = BASE_DIR / "uploads"
WEB_DIR = BASE_DIR / "web"
ICD_DIR = UPLOADS_DIR / "ICD"

# Ports
WEB_PORT = 8554
API_PORT = 8654

# Cache
CACHE_EXPIRY_DAYS = 30
