# ui/template_visites_view.py
import flet as ft
from datetime import datetime
from .template_editor_view import TemplateEditorView


class TemplateVisitesView:
    """Vue de gestion des templates de visite"""

    def __init__(self, page: ft.Page, file_picker: ft.FilePicker, snack_callback, changer_contenu_callback=None):
        self.page = page
        self.file_picker = file_picker
        self.snack = snack_callback
        self.changer_contenu = changer_contenu_callback

        # Templates de visite disponibles
        self.templates = [
            {"name": "Suivi CVS", "icon": ft.Icons.CHECKLIST, "color": ft.Colors.GREEN, "description": "Contrôle de Validation en Site"},
            {"name": "Suivi MVS", "icon": ft.Icons.UPGRADE, "color": ft.Colors.ORANGE, "description": "Mise en Service"},
            {"name": "Suivi RU", "icon": ft.Icons.FACTORY, "color": ft.Colors.PURPLE, "description": "Recette Usine"},
            {"name": "Suivi CRU", "icon": ft.Icons.BUILD, "color": ft.Colors.BLUE, "description": "Contrôle de Recette Usine"},
            {"name": "Réception/MST Site", "icon": ft.Icons.HOME_REPAIR_SERVICE, "color": ft.Colors.TEAL, "description": "Réception et Mise en Service sur site"},
            {"name": "Visite Activité", "icon": ft.Icons.EVENT_NOTE, "color": ft.Colors.INDIGO, "description": "Rapport de visite d'activité"},
        ]

        # Contrôles UI
        self.templates_list = None

        self.view = self.create_view()

    def create_view(self):
        """Crée la vue principale de gestion des templates"""

        # Section gestion des templates
        templates_section = self._create_templates_section()

        # Section liste des templates
        list_section = self._create_list_section()

        return ft.Container(
            content=ft.Column([
                templates_section,
                ft.Container(height=20),
                list_section,
            ], expand=True, spacing=0),
            padding=10,
            expand=True,
        )

    def _create_templates_section(self):
        """Crée la section de gestion des templates"""

        # Boutons des templates
        template_buttons = []
        for template in self.templates:
            btn = ft.ElevatedButton(
                text=template["name"],
                icon=template["icon"],
                on_click=lambda e, t=template: self._open_template_editor(t),
                style=ft.ButtonStyle(
                    color=ft.Colors.WHITE,
                    bgcolor=template["color"],
                    padding=15,
                ),
                height=60,
                width=200,
            )
            template_buttons.append(btn)

        return ft.Container(
            content=ft.Column([
                ft.Text("Gestion des templates de visite", size=20, weight=ft.FontWeight.BOLD),
                ft.Divider(height=10),
                ft.Container(
                    content=ft.Row(
                        template_buttons,
                        spacing=10,
                        wrap=True,
                    ),
                    padding=10,
                ),
            ]),
            padding=20,
            border=ft.border.all(2, ft.Colors.BLUE_200),
            border_radius=10,
            bgcolor=ft.Colors.BLUE_50,
        )

    def _create_list_section(self):
        """Crée la section de liste des templates"""

        # Liste des templates
        self.templates_list = ft.ListView(
            spacing=10,
            padding=10,
            expand=True,
        )

        # Boutons d'action
        action_buttons = ft.Row([
            ft.ElevatedButton(
                "Ajouter un template",
                icon=ft.Icons.ADD,
                on_click=lambda e: self._show_add_template_dialog(),
            ),
            ft.ElevatedButton(
                "Importer depuis fichier",
                icon=ft.Icons.UPLOAD_FILE,
                on_click=lambda e: self.snack("Import de template (à implémenter)"),
            ),
            ft.ElevatedButton(
                "Exporter tous",
                icon=ft.Icons.DOWNLOAD,
                on_click=lambda e: self.snack("Export des templates (à implémenter)"),
            ),
        ], spacing=10)

        # Section liste
        list_container = ft.Container(
            content=ft.Column([
                ft.Row([
                    ft.Text("Templates disponibles", size=18, weight=ft.FontWeight.BOLD),
                    ft.Container(expand=True),
                    action_buttons,
                ]),
                ft.Divider(height=5),
                ft.Container(
                    content=self.templates_list,
                    expand=True,
                    border=ft.border.all(1, ft.Colors.GREY_300),
                    border_radius=5,
                    padding=5,
                ),
            ], expand=True),
            padding=20,
            expand=True,
        )

        # Remplir la liste initiale
        self._refresh_templates_list()

        return list_container

    def _refresh_templates_list(self):
        """Rafraîchit la liste des templates"""
        if not self.templates_list:
            return

        self.templates_list.controls.clear()

        if not self.templates:
            self.templates_list.controls.append(
                ft.Container(
                    content=ft.Text("Aucun template de visite", italic=True, color=ft.Colors.GREY_600),
                    padding=20,
                    alignment=ft.alignment.center,
                )
            )
        else:
            for template in self.templates:
                card = self._create_template_card(template)
                self.templates_list.controls.append(card)

        if self.page:
            self.page.update()

    def _create_template_card(self, template):
        """Crée une carte pour un template"""

        def edit_template(e, t=template):
            self._show_edit_template_dialog(t)

        def delete_template(e, t=template):
            self._show_delete_confirmation(t)

        def view_details(e, t=template):
            self._show_template_details(t)

        def fill_cr(e, t=template):
            self._show_visite_form(t)

        return ft.Card(
            content=ft.Container(
                content=ft.Row([
                    ft.Icon(
                        name=template["icon"],
                        color=template["color"],
                        size=40,
                    ),
                    ft.Column([
                        ft.Text(template["name"], weight=ft.FontWeight.BOLD, size=14),
                        ft.Text(
                            template.get("description", ""),
                            size=12,
                            color=ft.Colors.GREY_700
                        ),
                    ], spacing=2, expand=True),
                    ft.ElevatedButton(
                        "📝 Remplir CR",
                        icon=ft.Icons.EDIT_NOTE,
                        on_click=fill_cr,
                        tooltip="Remplir un compte-rendu",
                        style=ft.ButtonStyle(bgcolor=ft.Colors.GREEN_700, color=ft.Colors.WHITE),
                    ),
                    ft.IconButton(
                        icon=ft.Icons.EDIT,
                        icon_color=ft.Colors.BLUE,
                        on_click=edit_template,
                        tooltip="Modifier le template",
                    ),
                    ft.IconButton(
                        icon=ft.Icons.VISIBILITY,
                        icon_color=ft.Colors.GREEN,
                        on_click=view_details,
                        tooltip="Voir les détails",
                    ),
                    ft.IconButton(
                        icon=ft.Icons.DELETE,
                        icon_color=ft.Colors.RED_400,
                        on_click=delete_template,
                        tooltip="Supprimer le template",
                    ),
                ], alignment=ft.MainAxisAlignment.START),
                padding=10,
            )
        )

    def _show_template_details(self, template):
        """Affiche les détails d'un template"""

        details_content = ft.Column([
            ft.Row([
                ft.Icon(name=template["icon"], color=template["color"], size=60),
                ft.Column([
                    ft.Text(template["name"], size=24, weight=ft.FontWeight.BOLD),
                    ft.Text(template.get("description", ""), size=14, color=ft.Colors.GREY_700),
                ], spacing=5, expand=True),
            ], spacing=20),
            ft.Divider(height=20),
            ft.Text("Sections par défaut:", weight=ft.FontWeight.BOLD),
            ft.Text("• Informations générales", size=12),
            ft.Text("• Points de contrôle", size=12),
            ft.Text("• Observations et remarques", size=12),
            ft.Text("• Conclusion", size=12),
            ft.Divider(height=20),
            ft.Text("Champs disponibles:", weight=ft.FontWeight.BOLD),
            ft.Text("• Poste (obligatoire)", size=12),
            ft.Text("• Date de visite (obligatoire)", size=12),
            ft.Text("• Intervenants", size=12),
            ft.Text("• Commentaires", size=12),
        ], spacing=10, scroll=ft.ScrollMode.AUTO)

        dialog = ft.AlertDialog(
            title=ft.Text("Détails du template"),
            content=ft.Container(
                content=details_content,
                width=500,
                height=400,
            ),
            actions=[
                ft.TextButton("Fermer", on_click=lambda e: self._close_dialog(dialog)),
            ],
        )

        self.page.overlay.append(dialog)
        dialog.open = True
        self.page.update()

    def _open_template_editor(self, template):
        """Ouvre l'éditeur pour un template"""
        if not self.changer_contenu:
            self.snack("⚠️ Impossible d'ouvrir l'éditeur (callback manquant)")
            return

        # Convertir les icônes et couleurs en format string pour le JSON
        icon_str = {
            ft.Icons.CHECKLIST: "CHECKLIST",
            ft.Icons.UPGRADE: "UPGRADE",
            ft.Icons.FACTORY: "FACTORY",
            ft.Icons.BUILD: "BUILD",
            ft.Icons.HOME_REPAIR_SERVICE: "HOME_REPAIR_SERVICE",
            ft.Icons.EVENT_NOTE: "EVENT_NOTE",
        }.get(template["icon"], "CHECKLIST")

        color_str = {
            ft.Colors.GREEN: "GREEN",
            ft.Colors.ORANGE: "ORANGE",
            ft.Colors.PURPLE: "PURPLE",
            ft.Colors.BLUE: "BLUE",
            ft.Colors.TEAL: "TEAL",
            ft.Colors.INDIGO: "INDIGO",
        }.get(template["color"], "BLUE")

        template_data = {
            "name": template["name"],
            "description": template.get("description", ""),
            "icon": icon_str,
            "color": color_str,
        }

        def on_save(template_structure):
            """Callback après sauvegarde du template"""
            self.snack(f"✅ Template '{template_structure['name']}' sauvegardé avec succès")
            # Retour à la vue des templates
            self.changer_contenu(self.view, "template_visites")

        def on_cancel():
            """Callback lors de l'annulation"""
            # Retour à la vue des templates
            self.changer_contenu(self.view, "template_visites")

        # Créer et afficher l'éditeur
        editor = TemplateEditorView(
            page=self.page,
            snack_callback=self.snack,
            template_data=template_data,
            on_save_callback=on_save,
            on_cancel_callback=on_cancel,
        )

        self.changer_contenu(editor.view, f"Édition : {template['name']}")

        # Rafraîchir les données après l'affichage
        editor.refresh_initial_data()

    def _show_add_template_dialog(self):
        """Affiche le dialogue d'ajout d'un nouveau template"""

        name_input = ft.TextField(
            label="Nom du template",
            hint_text="Ex: Suivi CRE",
            width=400,
        )

        description_input = ft.TextField(
            label="Description",
            hint_text="Ex: Contrôle de Réception en Exploitation",
            width=400,
            multiline=True,
            min_lines=2,
            max_lines=4,
        )

        icon_dropdown = ft.Dropdown(
            label="Icône",
            width=400,
            options=[
                ft.dropdown.Option(text="Checklist", key="CHECKLIST"),
                ft.dropdown.Option(text="Upgrade", key="UPGRADE"),
                ft.dropdown.Option(text="Factory", key="FACTORY"),
                ft.dropdown.Option(text="Build", key="BUILD"),
                ft.dropdown.Option(text="Home Repair", key="HOME_REPAIR_SERVICE"),
                ft.dropdown.Option(text="Event Note", key="EVENT_NOTE"),
            ],
            value="CHECKLIST",
        )

        color_dropdown = ft.Dropdown(
            label="Couleur",
            width=400,
            options=[
                ft.dropdown.Option(text="Vert", key="GREEN"),
                ft.dropdown.Option(text="Orange", key="ORANGE"),
                ft.dropdown.Option(text="Violet", key="PURPLE"),
                ft.dropdown.Option(text="Bleu", key="BLUE"),
                ft.dropdown.Option(text="Turquoise", key="TEAL"),
                ft.dropdown.Option(text="Indigo", key="INDIGO"),
            ],
            value="GREEN",
        )

        def create_template(e):
            if not name_input.value:
                self.snack("⚠️ Le nom du template est requis")
                return

            # TODO: Ajouter la logique de création du template
            self.snack(f"✅ Template '{name_input.value}' créé (à implémenter)")
            dialog.open = False
            self.page.update()

        dialog = ft.AlertDialog(
            title=ft.Text("Ajouter un nouveau template"),
            content=ft.Column([
                name_input,
                description_input,
                icon_dropdown,
                color_dropdown,
            ], tight=True, spacing=15, scroll=ft.ScrollMode.AUTO),
            actions=[
                ft.TextButton("Annuler", on_click=lambda e: self._close_dialog(dialog)),
                ft.ElevatedButton("Créer", on_click=create_template),
            ],
        )

        self.page.overlay.append(dialog)
        dialog.open = True
        self.page.update()

    def _show_edit_template_dialog(self, template):
        """Affiche le dialogue d'édition d'un template"""
        self.snack(f"Édition du template '{template['name']}' (à implémenter)")

    def _show_delete_confirmation(self, template):
        """Affiche la confirmation de suppression d'un template"""

        def confirm_delete(e):
            # TODO: Ajouter la logique de suppression
            self.snack(f"🗑️ Template '{template['name']}' supprimé (à implémenter)")
            dialog.open = False
            self.page.update()

        def cancel_delete(e):
            dialog.open = False
            self.page.update()

        dialog = ft.AlertDialog(
            title=ft.Text("Confirmer la suppression"),
            content=ft.Text(f"Voulez-vous vraiment supprimer le template '{template['name']}' ?\n\nCette action est irréversible."),
            actions=[
                ft.TextButton("Annuler", on_click=cancel_delete),
                ft.ElevatedButton(
                    "Supprimer",
                    on_click=confirm_delete,
                    style=ft.ButtonStyle(bgcolor=ft.Colors.RED, color=ft.Colors.WHITE)
                ),
            ],
        )

        self.page.overlay.append(dialog)
        dialog.open = True
        self.page.update()

    def _close_dialog(self, dialog):
        """Ferme un dialogue"""
        dialog.open = False
        self.page.update()

    def _show_visite_form(self, template):
        """Affiche le formulaire de remplissage de compte-rendu"""
        from .visite_form_view import VisiteFormView

        # Créer la vue de formulaire
        form_view = VisiteFormView(
            page=self.page,
            snack_callback=self.snack,
            template_data=template,
            on_back_callback=lambda: self.changer_contenu(self.view, "Templates de visite"),
        )

        # Afficher le formulaire
        self.changer_contenu(form_view.view, f"CR: {template['name']}")

    def refresh_view(self):
        """Rafraîchit la vue"""
        self._refresh_templates_list()

    def on_view_activated(self):
        """Appelé quand la vue est activée"""
        self.refresh_view()
