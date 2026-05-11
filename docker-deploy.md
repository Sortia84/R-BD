<div align="center">

<img src="assets/RCONTROLE.png" alt="R-CONTROL" width="280"/>

# R#BD v2.0.0

**Base de données R#SPACE pour ressources IEC 61850**

*Importer · Cataloguer · Associer · Réutiliser*

[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)]()

</div>

# Deploiement Docker - R#BD

Ce document decrit le lancement Docker autonome de `apps/r_bd`, aligne sur la
convention de `apps/r_planning`.

## Prerequis

- Docker et Docker Compose disponibles sur la machine cible.
- Reseau Docker externe `rcontrol_shared` existant.
- Dossiers hotes persistants disponibles :
  - `/opt/R_BD/data`
  - `/opt/R_BD/uploads`
  - `/opt/_ui_kit`

## Preparation VM

```bash
docker network inspect rcontrol_shared >/dev/null 2>&1 || \
  docker network create rcontrol_shared

sudo mkdir -p /opt/R_BD/data /opt/R_BD/uploads /opt/_ui_kit
sudo chmod -R 755 /opt/R_BD /opt/_ui_kit
```

Le dossier `/opt/_ui_kit` doit contenir le UI Kit partage R-CONTROL. En
conteneur, `api/shared.py` resout ce dossier via `/_ui_kit`.

## Lancement

Depuis le dossier applicatif :

```bash
cd apps/r_bd
docker compose build r-bd
docker compose up -d r-bd
```

## Verification

```bash
docker compose ps
docker logs --tail 100 r-bd
curl http://localhost:8551/health
curl http://localhost:8551/api/v1/templates/health
curl http://localhost:8551/ui-kit/css/tokens.css
docker network inspect rcontrol_shared
```

Depuis un autre conteneur du reseau partage :

```bash
docker run --rm --network rcontrol_shared curlimages/curl:latest \
  http://r-bd:8551/health
```

## Maintenance

```bash
cd apps/r_bd
docker compose build r-bd
docker compose up -d r-bd
docker logs --tail 100 r-bd
```

Les donnees et uploads sont persistants via `/opt/R_BD`. Ne pas supprimer ces
dossiers sans sauvegarde.