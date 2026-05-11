"""
main.py — Point d'entrée R#BD.

Lance l'application FastAPI (definie dans api_web.py) via uvicorn.
"""

from __future__ import annotations

import logging

import uvicorn

from config import APP_NAME, APP_VERSION, WEB_PORT


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("main[r_bd]")


def main() -> None:
    """Démarre R#BD (FastAPI + frontend statique)."""
    logger.info("=" * 70)
    logger.info("Demarrage %s v%s", APP_NAME, APP_VERSION)
    logger.info("=" * 70)
    logger.info("Interface web : http://localhost:%d", WEB_PORT)
    logger.info("API REST      : http://localhost:%d/api/*", WEB_PORT)
    logger.info("API Docs      : http://localhost:%d/docs", WEB_PORT)

    try:
        # workers=1 : la base utilisateurs et le dashboard sont stockes en
        # JSON local sans verrou inter-process. Un seul worker garantit
        # la coherence des ecritures.
        uvicorn.run(
            "api_web:app",
            host="0.0.0.0",
            port=WEB_PORT,
            reload=False,
            log_level="info",
        )
    except KeyboardInterrupt:
        logger.info("Arret demande par l'utilisateur")
    except Exception as exc:
        logger.error("Erreur fatale au demarrage : %s", exc)
        raise


if __name__ == "__main__":
    main()
