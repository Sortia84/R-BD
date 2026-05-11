# ============================================================================
# Dockerfile R#BD
#
# Objectif :
#   Construire une image runtime stable pour l'application R#BD, en suivant
#   l'organisation Docker locale utilisee par R#PLANNING.
#
# Principes :
#   - image de base Python 3.11 entreprise, coherente avec R#PLANNING ;
#   - dependances decrites dans requirements.txt ;
#   - copie limitee aux artefacts utiles au runtime ;
#   - conservation des points de montage /app/data et /app/uploads ;
#   - UI Kit partage monte par docker-compose sur /_ui_kit.
# ============================================================================

FROM inca.rte-france.com/antares/python3.11-rte:1.1

LABEL maintainer="RTE - R#BD"
LABEL description="R#BD - Base de donnees R#SPACE IEC 61850 (FastAPI + Web)"

WORKDIR /app

# Variables standard Python.
# WEB_PORT pilote le port interne lu par config.py.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    WEB_PORT=8551 \
    RBD_RELOAD=0

# ---------------------------------------------------------------------------
# Dependances Python runtime
# ---------------------------------------------------------------------------
COPY requirements.txt /tmp/requirements.txt

RUN python3 -m pip install \
        --no-cache-dir \
        -r /tmp/requirements.txt \
    && rm -rf /tmp/requirements.txt

# ---------------------------------------------------------------------------
# Runtime applicatif
# ---------------------------------------------------------------------------
# Les dossiers data/ et uploads/ sont volontairement prepares comme volumes :
# le contenu persistant est fourni par le montage hote au demarrage.
COPY api/ /app/api/
COPY assets/ /app/assets/
COPY core/ /app/core/
COPY web/ /app/web/
COPY api_web.py /app/api_web.py
COPY config.py /app/config.py
COPY main.py /app/main.py

# ---------------------------------------------------------------------------
# Points de montage persistes
# ---------------------------------------------------------------------------
RUN mkdir -p /app/data /app/uploads /app/uploads/ICD /app/uploads/rac \
    && chmod -R 755 /app/data /app/uploads

EXPOSE 8551

# ---------------------------------------------------------------------------
# Healthcheck
# ---------------------------------------------------------------------------
# Endpoint applicatif dedie aux sondes d'exploitation.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8551/health')" || exit 1

# ---------------------------------------------------------------------------
# Demarrage
# ---------------------------------------------------------------------------
CMD ["python3", "/app/main.py"]