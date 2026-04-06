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
# Normalisation ports (phase 1)
# Application servie en mono-port sur WEB_PORT, API_PORT reservé.
WEB_PORT = 8551
API_PORT = 8651

# Cache
CACHE_EXPIRY_DAYS = 30
