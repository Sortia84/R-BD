import flet as ft
from pathlib import Path

def create_header(page: ft.Page, logo_path, header_bgcolor, nav_buttons, theme_switch=None):
    """
    Crée le header avec logo en overlay, titre centré et copyright.
    Le paramètre theme_switch est conservé pour compatibilité mais n'est plus utilisé.
    """
    # Header avec fond bleu fixe
    header_bgcolor = "#00A7DE"

    header_content = ft.Container(
        height=160,
        bgcolor=header_bgcolor,
        padding=20,
        content=ft.Column([
            # Stack pour centrer visuellement le titre malgré le copyright à droite
            ft.Stack([
                # Layer 1 : Ligne avec copyright à droite
                ft.Row([
                    ft.Container(expand=True),
                    ft.Column([
                        ft.Row([]),  # Espace vide pour alignement
                        ft.Text(
                            "© 2025 APPLETON - RTE R#CONTROLE",
                            size=11,
                            color="white",
                        ),
                    ], horizontal_alignment=ft.CrossAxisAlignment.END),
                ], alignment=ft.MainAxisAlignment.SPACE_BETWEEN, vertical_alignment=ft.CrossAxisAlignment.CENTER),

                # Layer 2 : Titre centré visuellement
                ft.Container(
                    alignment=ft.alignment.center,
                    content=ft.Text(
                        "R#BD - Base de Données",
                        size=28,
                        weight=ft.FontWeight.BOLD,
                        color="white",
                    ),
                ),
            ], expand=True),

            ft.Divider(color="white", thickness=1, height=15),
            ft.Container(
                content=nav_buttons,
                alignment=ft.alignment.center,
            ),
        ], spacing=10),
    )

    # Logo par-dessus le header (en overlay)
    logo_widget = ft.Container(
        content=ft.Image(
            src="/RCONTROLE.png",
            width=140,
            height=140,
            fit=ft.ImageFit.CONTAIN,
        ),
        left=20,
        top=-30,
    )

    return ft.Stack([
        header_content,
        logo_widget,
    ])
