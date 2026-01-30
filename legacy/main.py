# main.py — Interface R#BD (Base de Données)
import argparse
import os
import secrets
import flet as ft

from config import LOGO_PATH, UPLOAD_DIR
from ui import create_header, TemplateVisitesView

def app_main():
    """Point d'entrée principal de l'application R#BD"""

    def view(page: ft.Page):
        # Configuration de la page
        page.title = "R#BD – Base de Données"
        page.window.maximized = True
        page.padding = 0
        page.scroll = ft.ScrollMode.AUTO
        page.theme_mode = ft.ThemeMode.LIGHT  # Forcer le thème clair

        # Fond bleu fixe (comme R_CONTROL)
        header_bgcolor = "#00A7DE"

        # Fonction snack pour les notifications
        def snack(msg: str):
            print(f"📢 [SNACK] {msg}")
            snackbar = ft.SnackBar(ft.Text(msg))
            page.overlay.append(snackbar)
            snackbar.open = True
            page.update()

        # File picker pour les imports
        file_picker = ft.FilePicker()
        page.overlay.append(file_picker)

        # Création des vues R#BD
        accueil_view = ft.Container(
            content=ft.Column([
                ft.Icon(name=ft.Icons.STORAGE, size=80, color=ft.Colors.BLUE),
                ft.Text("Bienvenue dans R#BD", size=32, weight=ft.FontWeight.BOLD),
                ft.Text("Base de données centralisée pour R#CONTROLE", size=16, color=ft.Colors.GREY_700),
            ], spacing=20, horizontal_alignment=ft.CrossAxisAlignment.CENTER),
            alignment=ft.alignment.center,
            expand=True
        )

        template_cvs_view = ft.Container(
            content=ft.Column([
                ft.Icon(name=ft.Icons.CHECKLIST, size=80, color=ft.Colors.GREEN),
                ft.Text("Templates CVS", size=32, weight=ft.FontWeight.BOLD),
                ft.Text("Gestion des templates de Contrôle de Validation en Site", size=16, color=ft.Colors.GREY_700),
            ], spacing=20, horizontal_alignment=ft.CrossAxisAlignment.CENTER),
            alignment=ft.alignment.center,
            expand=True
        )

        template_mvs_view = ft.Container(
            content=ft.Column([
                ft.Icon(name=ft.Icons.UPGRADE, size=80, color=ft.Colors.ORANGE),
                ft.Text("Templates MVS", size=32, weight=ft.FontWeight.BOLD),
                ft.Text("Gestion des templates de Mise en Service", size=16, color=ft.Colors.GREY_700),
            ], spacing=20, horizontal_alignment=ft.CrossAxisAlignment.CENTER),
            alignment=ft.alignment.center,
            expand=True
        )

        template_ru_view = ft.Container(
            content=ft.Column([
                ft.Icon(name=ft.Icons.FACTORY, size=80, color=ft.Colors.PURPLE),
                ft.Text("Templates RU", size=32, weight=ft.FontWeight.BOLD),
                ft.Text("Gestion des templates de Recette Usine", size=16, color=ft.Colors.GREY_700),
            ], spacing=20, horizontal_alignment=ft.CrossAxisAlignment.CENTER),
            alignment=ft.alignment.center,
            expand=True
        )

        # === PAGE TEMPLATE VISITES - Gestion des templates de visite ===
        # Sera initialisée après la définition de changer_contenu
        template_visites_view_manager = None
        template_visites_view = None

        icd_view = ft.Container(
            content=ft.Column([
                ft.Icon(name=ft.Icons.DESCRIPTION, size=80, color=ft.Colors.BLUE),
                ft.Text("Fichiers ICD", size=32, weight=ft.FontWeight.BOLD),
                ft.Text("Gestion des fichiers ICD (IED Configuration Description)", size=16, color=ft.Colors.GREY_700),
            ], spacing=20, horizontal_alignment=ft.CrossAxisAlignment.CENTER),
            alignment=ft.alignment.center,
            expand=True
        )

        risa_view = ft.Container(
            content=ft.Column([
                ft.Icon(name=ft.Icons.TABLE_CHART, size=80, color=ft.Colors.TEAL),
                ft.Text("Fichiers RISA", size=32, weight=ft.FontWeight.BOLD),
                ft.Text("Gestion des fichiers RISA (Référentiel ISA)", size=16, color=ft.Colors.GREY_700),
            ], spacing=20, horizontal_alignment=ft.CrossAxisAlignment.CENTER),
            alignment=ft.alignment.center,
            expand=True
        )

        equations_view = ft.Container(
            content=ft.Column([
                ft.Icon(name=ft.Icons.FUNCTIONS, size=80, color=ft.Colors.INDIGO),
                ft.Text("Fichiers Équations", size=32, weight=ft.FontWeight.BOLD),
                ft.Text("Gestion des fichiers d'équations", size=16, color=ft.Colors.GREY_700),
            ], spacing=20, horizontal_alignment=ft.CrossAxisAlignment.CENTER),
            alignment=ft.alignment.center,
            expand=True
        )

        # Navigation
        main_column = ft.Column(scroll=ft.ScrollMode.AUTO, expand=True, spacing=0)
        current_view = "accueil"

        def changer_contenu(vue, view_name):
            nonlocal current_view
            current_view = view_name
            main_column.controls.clear()
            main_column.controls.append(vue)
            update_nav_buttons()
            page.update()

        # Initialisation du template visites view maintenant que changer_contenu est défini
        template_visites_view_manager = TemplateVisitesView(page, file_picker, snack, changer_contenu)
        template_visites_view = template_visites_view_manager.view

        def show_accueil(e):
            changer_contenu(accueil_view, "accueil")

        def show_template_cvs(e):
            changer_contenu(template_cvs_view, "template_cvs")

        def show_template_mvs(e):
            changer_contenu(template_mvs_view, "template_mvs")

        def show_template_ru(e):
            changer_contenu(template_ru_view, "template_ru")

        def show_template_visites(e):
            changer_contenu(template_visites_view, "template_visites")

        def show_icd(e):
            changer_contenu(icd_view, "icd")

        def show_risa(e):
            changer_contenu(risa_view, "risa")

        def show_equations(e):
            changer_contenu(equations_view, "equations")

        # Configuration des boutons de navigation
        nav_button_configs = [
            ("accueil", "Accueil", ft.Icons.HOME, show_accueil),
            ("template_cvs", "Template CVS", ft.Icons.CHECKLIST, show_template_cvs),
            ("template_mvs", "Template MVS", ft.Icons.UPGRADE, show_template_mvs),
            ("template_ru", "Template RU", ft.Icons.FACTORY, show_template_ru),
            ("template_visites", "Template Visites", ft.Icons.TOUR, show_template_visites),
            ("icd", "ICD", ft.Icons.DESCRIPTION, show_icd),
            ("risa", "RISA", ft.Icons.TABLE_CHART, show_risa),
            ("equations", "Équations", ft.Icons.FUNCTIONS, show_equations),
        ]

        nav_buttons_dict = {}

        def create_nav_button(key, text, icon, on_click):
            btn = ft.TextButton(
                text, icon=icon, on_click=on_click,
                style=ft.ButtonStyle(
                    color="white",
                    bgcolor="#0088CC" if current_view == key else "transparent",
                    padding=ft.Padding(15, 12, 15, 12),
                ),
            )
            nav_buttons_dict[key] = btn
            return btn

        def update_nav_buttons():
            for key, btn in nav_buttons_dict.items():
                if key == current_view:
                    btn.style.bgcolor = "#0088CC"
                else:
                    btn.style.bgcolor = "transparent"
            page.update()

        nav_buttons = ft.Row(
            [create_nav_button(key, text, icon, on_click) for key, text, icon, on_click in nav_button_configs],
            spacing=5,
            alignment=ft.MainAxisAlignment.CENTER,
            wrap=True,  # Permet le retour à la ligne si trop de boutons
        )

        # Header (sans theme_switch)
        header = create_header(page, LOGO_PATH, header_bgcolor, nav_buttons)

        # Affichage initial
        changer_contenu(accueil_view, "accueil")

        # Ajout à la page
        page.add(
            ft.Column([
                header,
                ft.Container(content=main_column, expand=True, padding=10),
            ], expand=True, spacing=0)
        )

        page.update()

    return view


if __name__ == "__main__":
    # Configuration de la secret key pour les uploads Flet
    FLET_SECRET_KEY = os.environ.get("FLET_SECRET_KEY", secrets.token_urlsafe(32))
    os.environ["FLET_SECRET_KEY"] = FLET_SECRET_KEY
    print(f"🔐 [MAIN] Secret key configurée pour les uploads")

    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8551, help="Port de l'interface (par défaut: 8551)")
    args = ap.parse_args()

    print(f"🚀 Lancement de R#BD sur http://{args.host}:{args.port}")

    # Lancer l'interface Flet
    ft.app(
        target=app_main(),
        view=ft.AppView.WEB_BROWSER,
        host=args.host,
        port=args.port,
        upload_dir=os.fspath(UPLOAD_DIR),
        assets_dir="assets",
    )
