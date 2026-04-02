# main.py — Launcher R#BD
"""
Point d'entrée du serveur R#BD.

Rôle :
  - Configurer le logging
  - Ajouter le répertoire courant au sys.path
  - Lancer uvicorn sur api_web:app

Toute la logique FastAPI (routeurs, static files, CORS) est dans api_web.py.
"""

import sys
import logging
from pathlib import Path

import uvicorn

# ============================================================================
# CONFIGURATION DU PATH
# ============================================================================
# Ajouter le répertoire courant au path Python pour que les imports
# relatifs (config, api, core) fonctionnent depuis n'importe quel CWD.
sys.path.insert(0, str(Path(__file__).parent))

from config import WEB_PORT


# ============================================================================
# CONFIGURATION LOGGING
# ============================================================================
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(name)s] %(levelname)s: %(message)s',
)
logger = logging.getLogger("MAIN[r_bd]")


# ============================================================================
# POINT D'ENTRÉE
# ============================================================================

def main():
    """
    Lance le serveur R#BD via uvicorn.

    Le module api_web.py contient l'application FastAPI complète.
    """
    logger.info("[MAIN] 🚀 R#BD démarré sur http://localhost:%d", WEB_PORT)
    logger.info("[MAIN] 📚 API disponible sur http://localhost:%d/docs", WEB_PORT)
    uvicorn.run(
        "api_web:app",
        host="0.0.0.0",
        port=WEB_PORT,
        reload=True,
        log_level="info",
    )


if __name__ == "__main__":
    main()
