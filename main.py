# main.py - Point d'entrée R#BD (API FastAPI + fichiers statiques)
"""
Lance le serveur R#BD avec :
- API REST pour la gestion des ICD
- Fichiers statiques (HTML/CSS/JS)
"""

import sys
from pathlib import Path

# Ajouter le répertoire courant au path pour les imports
sys.path.insert(0, str(Path(__file__).parent))

import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from api.icd_api import router as icd_router

# Configuration
BASE_DIR = Path(__file__).parent
WEB_DIR = BASE_DIR / "web"
DATA_DIR = BASE_DIR / "data"
UPLOADS_DIR = BASE_DIR / "uploads"

WEB_PORT = 8554
API_PORT = 8654

# Application FastAPI
app = FastAPI(
    title="R#BD - Base de données R#SPACE",
    description="API pour la gestion des ICD et templates",
    version="1.0.0"
)

# Inclure les routes API
app.include_router(icd_router)

# Servir les fichiers statiques
app.mount("/web", StaticFiles(directory=str(WEB_DIR)), name="web")
app.mount("/data", StaticFiles(directory=str(DATA_DIR)), name="data")
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")
app.mount("/assets", StaticFiles(directory=str(BASE_DIR / "assets")), name="assets")


@app.get("/")
async def root():
    """Redirige vers la page d'accueil."""
    return FileResponse(str(BASE_DIR / "index.html"))


@app.get("/health")
async def health():
    """Endpoint de santé."""
    return {"status": "ok", "app": "R#BD"}


def main():
    """Lance le serveur."""
    print(f"🚀 R#BD démarré sur http://localhost:{WEB_PORT}")
    print(f"📚 API disponible sur http://localhost:{WEB_PORT}/docs")
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=WEB_PORT,
        reload=True
    )


if __name__ == "__main__":
    main()
