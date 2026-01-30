# Code Python archivé - R#BD

Ce dossier contient le code Python/Flet de R#BD qui a été archivé lors de la migration vers une application HTML/CSS/JS pure.

## 📁 Contenu

- `main.py` : Point d'entrée de l'application Flet
- `config.py` : Configuration (ports, chemins)
- `core/` : Logique métier (template_manager, etc.)
- `ui/` : Interface utilisateur Flet

## 🔄 Réactivation

Si besoin de réactiver l'API REST Python :

1. Restaurer les fichiers :
   ```bash
   cd apps/r_bd
   mv legacy/main.py .
   mv legacy/config.py .
   mv legacy/core .
   mv legacy/ui .
   ```

2. Lancer l'application :
   ```bash
   python main.py
   ```

3. API disponible sur : `http://localhost:8554/docs`

## 💡 Raison de l'archivage

La gestion des templates RU ne nécessite pas de backend Python pour le moment :
- Cas d'usage = création/édition de fichiers JSON simples
- File System Access API ou LocalStorage suffisent
- Déploiement ultra-simplifié (HTML statique)
- Pas d'intégration API nécessaire avec R#GUIDE pour l'instant

## 📅 Date d'archivage

30 janvier 2026
