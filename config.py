# config.py - Configuration R#BD
"""
Configuration centralisée pour R#BD.
"""

from pathlib import Path

# Répertoires
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
WEB_DIR = BASE_DIR / "web"
ICD_DIR = UPLOADS_DIR / "ICD"


# ============================================================================
# Identite applicative et ports
# ============================================================================

APP_NAME = "R#BD"
APP_VERSION = "1.0.0"
WEB_PORT = 8551
API_PORT = 8654


# Cache
CACHE_EXPIRY_DAYS = 30