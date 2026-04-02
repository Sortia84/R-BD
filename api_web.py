# api_web.py — Point d'entrée FastAPI pour R#BD
#
# Rôle :
#   Créer l'application FastAPI, monter les routeurs métier et servir
#   l'interface web (HTML/CSS/JS) via StaticFiles.
#
#   Toute la logique des endpoints est déléguée aux routeurs dans api/ :
#     - api/router_icd.py       : Endpoints ICD (import, catalogue, patterns)
#     - api/router_isa.py       : Endpoints ISA (import, types, fichiers)
#     - api/router_mapping.py   : Endpoints Mapping (consultation IEC 61850)
#     - api/router_essais.py    : Endpoints Essais (CRUD RU/CVS/MVS)
#     - api/router_templates.py : Endpoints Templates (CRUD)
#     - api/router_fcs.py       : Endpoints FCS (import, comparaison)
#     - api/router_rac.py       : Endpoints Fichiers RAC
#
#   L'état partagé (managers, helpers, config) est centralisé dans api/shared.py.
#
# Version : 2.0.0
# Port : 8597

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# ============================================================================
# IMPORT DES ROUTEURS ET DE LA CONFIGURATION PARTAGÉE
# ============================================================================
from api import (
    icd_router,
    isa_router,
    mapping_router,
    essais_router,
    templates_router,
    fcs_router,
    rac_router,
)
from api.shared import WEB_DIR, ASSETS_DIR, UI_KIT_DIR, DATA_DIR, UPLOADS_DIR


# ============================================================================
# CONFIGURATION LOGGING
# ============================================================================
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(name)s] %(levelname)s: %(message)s',
)
logger = logging.getLogger("API[r_bd]")


# ============================================================================
# LIFECYCLE (lifespan context manager — remplace @app.on_event déprécié)
# ============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Gestion du cycle de vie de l'application : startup / shutdown.

    Au démarrage, loggue les chemins critiques pour faciliter le diagnostic.
    À l'arrêt, loggue la fermeture propre.
    """
    # --- Startup ---
    logger.info("[API][Startup] R#BD api_web v2.0.0 démarrée")
    logger.info("   - WEB_DIR    : %s", WEB_DIR)
    logger.info("   - DATA_DIR   : %s", DATA_DIR)
    logger.info("   - UPLOADS_DIR: %s", UPLOADS_DIR)
    logger.info("   - ASSETS_DIR : %s", ASSETS_DIR)
    logger.info("   - UI_KIT_DIR : %s", UI_KIT_DIR)
    yield
    # --- Shutdown ---
    logger.info("[API][Shutdown] R#BD api_web v2.0.0 arrêtée")


# ============================================================================
# FASTAPI APP
# ============================================================================
app = FastAPI(
    title="R#BD — Base de données R#SPACE",
    description="API pour la gestion des ICD, ISA, templates, FCS et fichiers RAC",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS — autoriser toutes les origines pour le développement local
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# MONTAGE DES ROUTEURS
# ============================================================================
app.include_router(icd_router)
app.include_router(isa_router)
app.include_router(mapping_router)
app.include_router(essais_router)
app.include_router(templates_router)
app.include_router(fcs_router)
app.include_router(rac_router)


# ============================================================================
# ENDPOINT DE SANTÉ
# ============================================================================

@app.get("/health", tags=["système"])
async def health():
    """Endpoint de santé pour vérifier que le serveur est opérationnel."""
    return {"status": "ok", "app": "R#BD", "version": "2.0.0"}


# ============================================================================
# STATIC FILES
# ============================================================================
# Ordre important : les montages les plus spécifiques d'abord,
# puis "/" en dernier car il capture tout.
# - /assets  → logo et ressources statiques
# - /ui-kit  → design tokens et base CSS mutualisés
# - /        → interface web SPA (html=True sert index.html automatiquement)
# ============================================================================
app.mount("/assets", StaticFiles(directory=str(ASSETS_DIR)), name="assets")
app.mount("/ui-kit", StaticFiles(directory=str(UI_KIT_DIR)), name="ui-kit")
app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
