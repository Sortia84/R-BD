# ui/template_editor_view.py
"""
Éditeur de template de visite pour R#BD
Permet de créer/modifier les catégories et étapes d'un template
"""
import flet as ft
import json
import unicodedata
from datetime import datetime
from pathlib import Path


class TemplateEditorView:
    """Vue d'édition d'un template de visite"""

    def __init__(self, page: ft.Page, snack_callback, template_data, on_save_callback=None, on_cancel_callback=None):
        self.page = page
        self.snack = snack_callback
        self.template_data = template_data  # {"name": "...", "icon": "...", "color": "..."}
        self.on_save = on_save_callback
        self.on_cancel = on_cancel_callback

        # Tenter de charger le JSON existant
        self.template_structure = self._load_or_create_template(template_data)

        # UI
        self.categories_list = None
        self.view = self.create_view()

        # Afficher les catégories chargées (si existantes) - le rafraîchissement se fera après l'ajout à la page
        self._needs_initial_refresh = len(self.template_structure.get("categories", [])) > 0

    def _load_or_create_template(self, template_data):
        """Charge le template existant ou en crée un nouveau"""
        # Construire le chemin du fichier JSON
        data_dir = Path(__file__).parent.parent / "data" / "templates"
        name = template_data.get("name", "")

        # Nettoyer le nom pour créer un nom de fichier valide
        name_normalized = unicodedata.normalize('NFKD', name).encode('ASCII', 'ignore').decode('ASCII')
        name_clean = ''.join(c if c.isalnum() else '_' for c in name_normalized)
        filename = f"{name_clean.lower()}.json"
        filepath = data_dir / filename

        # Si le fichier existe, le charger
        if filepath.exists():
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    loaded_template = json.load(f)
                    # Mettre à jour les métadonnées au cas où elles auraient changé
                    loaded_template["icon"] = template_data.get("icon", loaded_template.get("icon", ""))
                    loaded_template["color"] = template_data.get("color", loaded_template.get("color", ""))
                    self.snack(f"📂 Template '{name}' chargé")
                    return loaded_template
            except Exception as e:
                self.snack(f"⚠️ Erreur de chargement : {str(e)}")

        # Sinon, créer une nouvelle structure
        return {
            "name": template_data.get("name", ""),
            "description": template_data.get("description", ""),
            "icon": template_data.get("icon", ""),
            "color": template_data.get("color", ""),
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "version": "1.0",
            "categories": []  # Liste des catégories avec leurs étapes
        }

    def create_view(self):
        """Crée la vue principale de l'éditeur"""

        # En-tête avec infos du template
        header = self._create_header()

        # Zone d'édition des catégories
        categories_section = self._create_categories_section()

        # Boutons d'action principaux
        action_buttons = ft.Row([
            ft.ElevatedButton(
                "Annuler",
                icon=ft.Icons.CANCEL,
                on_click=lambda e: self._handle_cancel(),
            ),
            ft.ElevatedButton(
                "Prévisualiser JSON",
                icon=ft.Icons.CODE,
                on_click=lambda e: self._show_json_preview(),
            ),
            ft.ElevatedButton(
                "Sauvegarder",
                icon=ft.Icons.SAVE,
                style=ft.ButtonStyle(bgcolor=ft.Colors.GREEN, color=ft.Colors.WHITE),
                on_click=lambda e: self._handle_save(),
            ),
        ], alignment=ft.MainAxisAlignment.END, spacing=10)

        return ft.Container(
            content=ft.Column([
                header,
                ft.Divider(height=20),
                categories_section,
                ft.Divider(height=20),
                action_buttons,
            ], expand=True, scroll=ft.ScrollMode.AUTO, spacing=10),
            padding=20,
            expand=True,
        )

    def refresh_initial_data(self):
        """Rafraîchit les données initiales après que la vue soit ajoutée à la page"""
        if self._needs_initial_refresh:
            self._refresh_categories_list()
            self.page.update()

    def _create_header(self):
        """Crée l'en-tête avec infos du template"""
        icon_map = {
            "CHECKLIST": ft.Icons.CHECKLIST,
            "UPGRADE": ft.Icons.UPGRADE,
            "FACTORY": ft.Icons.FACTORY,
            "BUILD": ft.Icons.BUILD,
            "HOME_REPAIR_SERVICE": ft.Icons.HOME_REPAIR_SERVICE,
            "EVENT_NOTE": ft.Icons.EVENT_NOTE,
        }

        color_map = {
            "GREEN": ft.Colors.GREEN,
            "ORANGE": ft.Colors.ORANGE,
            "PURPLE": ft.Colors.PURPLE,
            "BLUE": ft.Colors.BLUE,
            "TEAL": ft.Colors.TEAL,
            "INDIGO": ft.Colors.INDIGO,
        }

        icon_name = icon_map.get(self.template_data.get("icon", "CHECKLIST"), ft.Icons.CHECKLIST)
        color = color_map.get(self.template_data.get("color", "BLUE"), ft.Colors.BLUE)

        # Indicateur si le template existe déjà
        nb_categories = len(self.template_structure.get("categories", []))
        status_text = f"📂 Template existant - {nb_categories} catégorie(s)" if nb_categories > 0 else "✨ Nouveau template"

        return ft.Container(
            content=ft.Row([
                ft.Icon(name=icon_name, color=color, size=60),
                ft.Column([
                    ft.Text(
                        f"Édition du template : {self.template_data.get('name', 'Sans nom')}",
                        size=24,
                        weight=ft.FontWeight.BOLD
                    ),
                    ft.Text(
                        self.template_data.get("description", ""),
                        size=14,
                        color=ft.Colors.GREY_700
                    ),
                    ft.Text(
                        status_text,
                        size=12,
                        color=ft.Colors.BLUE_700,
                        italic=True
                    ),
                ], spacing=5, expand=True),
            ], spacing=20),
            padding=10,
            border=ft.border.all(2, color),
            border_radius=10,
            bgcolor=ft.Colors.with_opacity(0.1, color),
        )

    def _create_categories_section(self):
        """Crée la section de gestion des catégories"""

        self.categories_list = ft.Column(spacing=10, scroll=ft.ScrollMode.AUTO)

        add_category_btn = ft.ElevatedButton(
            "Ajouter une catégorie",
            icon=ft.Icons.ADD,
            on_click=lambda e: self._show_add_category_dialog(),
        )

        return ft.Container(
            content=ft.Column([
                ft.Row([
                    ft.Text("Catégories et étapes de test", size=18, weight=ft.FontWeight.BOLD),
                    ft.Container(expand=True),
                    add_category_btn,
                ]),
                ft.Divider(height=10),
                ft.Container(
                    content=self.categories_list,
                    expand=True,
                    border=ft.border.all(1, ft.Colors.GREY_300),
                    border_radius=5,
                    padding=10,
                ),
            ], expand=True),
            expand=True,
        )

    def _show_add_category_dialog(self):
        """Dialogue pour ajouter une catégorie"""

        name_input = ft.TextField(
            label="Nom de la catégorie",
            hint_text="Ex: Contrôles visuels, Tests fonctionnels...",
            width=500,
        )

        description_input = ft.TextField(
            label="Description (optionnel)",
            hint_text="Description de cette catégorie de tests",
            width=500,
            multiline=True,
            min_lines=2,
            max_lines=4,
        )

        # Liste d'icônes disponibles pour les catégories
        icon_options = [
            ("CHECKLIST", "📋 Liste de contrôle"),
            ("SETTINGS", "⚙️ Configuration"),
            ("VISIBILITY", "👁️ Contrôles visuels"),
            ("BUILD", "🔧 Tests mécaniques"),
            ("ELECTRICAL_SERVICES", "⚡ Tests électriques"),
            ("CABLE", "🔌 Câblage"),
            ("NETWORK_CHECK", "🌐 Tests réseau"),
            ("MEMORY", "💾 Tests électroniques"),
            ("SPEED", "⚡ Tests de performance"),
            ("SECURITY", "🔒 Sécurité"),
            ("SCIENCE", "🔬 Tests fonctionnels"),
            ("VERIFIED", "✅ Validation"),
            ("FOLDER", "📁 Documentation"),
            ("ASSESSMENT", "📝 Rapport"),
        ]

        icon_dropdown = ft.Dropdown(
            label="Icône de la catégorie",
            width=500,
            value="CHECKLIST",
            options=[ft.dropdown.Option(key=key, text=text) for key, text in icon_options],
        )

        def create_category(e):
            if not name_input.value:
                self.snack("⚠️ Le nom de la catégorie est requis")
                return

            category = {
                "id": f"cat_{len(self.template_structure['categories'])}",
                "name": name_input.value,
                "description": description_input.value or "",
                "icon": icon_dropdown.value,
                "expanded": True,
                "steps": []
            }

            self.template_structure["categories"].append(category)
            self._refresh_categories_list()
            self.snack(f"✅ Catégorie '{name_input.value}' ajoutée")
            dialog.open = False
            self.page.update()

        dialog = ft.AlertDialog(
            title=ft.Text("Ajouter une catégorie"),
            content=ft.Column([
                name_input,
                icon_dropdown,
                description_input,
            ], tight=True, spacing=15),
            actions=[
                ft.TextButton("Annuler", on_click=lambda e: self._close_dialog(dialog)),
                ft.ElevatedButton("Ajouter", on_click=create_category),
            ],
        )

        self.page.overlay.append(dialog)
        dialog.open = True
        self.page.update()

    def _refresh_categories_list(self):
        """Rafraîchit l'affichage des catégories"""
        self.categories_list.controls.clear()

        if not self.template_structure["categories"]:
            self.categories_list.controls.append(
                ft.Container(
                    content=ft.Text(
                        "Aucune catégorie. Cliquez sur 'Ajouter une catégorie' pour commencer.",
                        italic=True,
                        color=ft.Colors.GREY_600
                    ),
                    padding=20,
                    alignment=ft.alignment.center,
                )
            )
        else:
            for i, category in enumerate(self.template_structure["categories"]):
                category_widget = self._create_category_widget(category, i)
                self.categories_list.controls.append(category_widget)

        self.page.update()

    def _create_category_widget(self, category, index):
        """Crée le widget d'une catégorie (ExpansionTile avec ses étapes)"""

        # Liste des étapes de cette catégorie
        steps_widgets = []
        for step_index, step in enumerate(category.get("steps", [])):
            step_card = self._create_step_card(step, index, step_index)
            steps_widgets.append(step_card)

        # Bouton pour ajouter une étape
        add_step_btn = ft.ElevatedButton(
            "Ajouter une étape",
            icon=ft.Icons.ADD_TASK,
            on_click=lambda e, cat_idx=index: self._show_add_step_dialog(cat_idx),
            style=ft.ButtonStyle(padding=10),
        )

        steps_column = ft.Column([
            *steps_widgets,
            ft.Container(content=add_step_btn, padding=ft.padding.only(top=10)),
        ], spacing=10)

        # Compter les étapes par criticité
        nb_obligatoire = sum(1 for step in category.get("steps", []) if step.get("criticite") == "Obligatoire")
        nb_recommande = sum(1 for step in category.get("steps", []) if step.get("criticite") == "Recommandé")
        nb_optionnel = sum(1 for step in category.get("steps", []) if step.get("criticite") == "Optionnel")

        # Créer les badges de criticité
        criticite_badges = []
        if nb_obligatoire > 0:
            criticite_badges.append(
                ft.Container(
                    content=ft.Row([
                        ft.Icon(ft.Icons.ERROR, size=16, color=ft.Colors.WHITE),
                        ft.Text(str(nb_obligatoire), size=12, weight=ft.FontWeight.BOLD, color=ft.Colors.WHITE),
                    ], spacing=4, tight=True),
                    bgcolor=ft.Colors.RED_700,
                    padding=ft.padding.symmetric(horizontal=8, vertical=4),
                    border_radius=12,
                    tooltip=f"{nb_obligatoire} étape(s) obligatoire(s)",
                )
            )
        if nb_recommande > 0:
            criticite_badges.append(
                ft.Container(
                    content=ft.Row([
                        ft.Icon(ft.Icons.WARNING, size=16, color=ft.Colors.WHITE),
                        ft.Text(str(nb_recommande), size=12, weight=ft.FontWeight.BOLD, color=ft.Colors.WHITE),
                    ], spacing=4, tight=True),
                    bgcolor=ft.Colors.ORANGE_700,
                    padding=ft.padding.symmetric(horizontal=8, vertical=4),
                    border_radius=12,
                    tooltip=f"{nb_recommande} étape(s) recommandée(s)",
                )
            )
        if nb_optionnel > 0:
            criticite_badges.append(
                ft.Container(
                    content=ft.Row([
                        ft.Icon(ft.Icons.INFO, size=16, color=ft.Colors.WHITE),
                        ft.Text(str(nb_optionnel), size=12, weight=ft.FontWeight.BOLD, color=ft.Colors.WHITE),
                    ], spacing=4, tight=True),
                    bgcolor=ft.Colors.BLUE_700,
                    padding=ft.padding.symmetric(horizontal=8, vertical=4),
                    border_radius=12,
                    tooltip=f"{nb_optionnel} étape(s) optionnelle(s)",
                )
            )

        # Titre avec icône, nom de catégorie et badges
        category_icon = category.get("icon", "CHECKLIST")
        title_row = ft.Row([
            ft.Icon(name=getattr(ft.Icons, category_icon, ft.Icons.CHECKLIST), size=20, color=ft.Colors.BLUE_700),
            ft.Text(category["name"], weight=ft.FontWeight.BOLD, size=16),
            *criticite_badges,
        ], spacing=8)

        # ExpansionTile pour la catégorie
        expansion_tile = ft.ExpansionTile(
            title=title_row,
            subtitle=ft.Text(category.get("description", ""), size=12) if category.get("description") else None,
            trailing=ft.Row([
                ft.IconButton(
                    icon=ft.Icons.ARROW_UPWARD,
                    icon_size=18,
                    tooltip="Monter la catégorie",
                    on_click=lambda e, cat_idx=index: self._move_category_up(cat_idx),
                ),
                ft.IconButton(
                    icon=ft.Icons.ARROW_DOWNWARD,
                    icon_size=18,
                    tooltip="Descendre la catégorie",
                    on_click=lambda e, cat_idx=index: self._move_category_down(cat_idx),
                ),
                ft.IconButton(
                    icon=ft.Icons.EDIT,
                    icon_color=ft.Colors.BLUE,
                    tooltip="Modifier la catégorie",
                    on_click=lambda e, cat_idx=index: self._edit_category(cat_idx),
                ),
                ft.IconButton(
                    icon=ft.Icons.DELETE,
                    icon_color=ft.Colors.RED,
                    tooltip="Supprimer la catégorie",
                    on_click=lambda e, cat_idx=index: self._delete_category(cat_idx),
                ),
            ], spacing=0, tight=True),
            controls=[steps_column],
            initially_expanded=category.get("expanded", True),
            bgcolor=ft.Colors.GREY_50,
        )

        return ft.Container(
            content=expansion_tile,
            border=ft.border.all(2, ft.Colors.BLUE_300),
            border_radius=10,
            padding=0,
            margin=ft.margin.only(bottom=10),
            shadow=ft.BoxShadow(
                spread_radius=1,
                blur_radius=4,
                color=ft.Colors.with_opacity(0.1, ft.Colors.BLACK),
                offset=ft.Offset(0, 2),
            ),
        )

    def _build_badges(self, step, criticality_color):
        """Construit la liste des badges sans None"""
        badges = []

        # Criticité (toujours affiché)
        badges.append(ft.Container(
            content=ft.Text(f"⚠️ {step.get('criticite', 'Recommandé')}", size=10, color=ft.Colors.WHITE),
            bgcolor=criticality_color,
            padding=ft.padding.symmetric(horizontal=8, vertical=3),
            border_radius=10,
        ))

        # Type de résultat (toujours affiché)
        badges.append(ft.Container(
            content=ft.Text(f"📊 {step.get('type_resultat', 'OK/NOK')}", size=10),
            bgcolor=ft.Colors.BLUE_100,
            padding=ft.padding.symmetric(horizontal=8, vertical=3),
            border_radius=10,
        ))

        # Durée estimée (si renseigné)
        if step.get("duree_estimee"):
            badges.append(ft.Container(
                content=ft.Text(f"⏱️ {step.get('duree_estimee')}", size=10),
                bgcolor=ft.Colors.GREY_200,
                padding=ft.padding.symmetric(horizontal=8, vertical=3),
                border_radius=10,
            ))

        # Outils nécessaires (si renseigné)
        if step.get("outils"):
            badges.append(ft.Container(
                content=ft.Text("🔧 Outils requis", size=10),
                bgcolor=ft.Colors.PURPLE_100,
                padding=ft.padding.symmetric(horizontal=8, vertical=3),
                border_radius=10,
                tooltip=step.get("outils", ""),
            ))

        # Compter le nombre de critères avec photo requise
        criteres = step.get("criteres_controle", [])
        photos_count = 0
        for critere in criteres:
            if isinstance(critere, dict) and critere.get("photo_requise", False):
                photos_count += 1

        # Afficher le badge photos si au moins un critère nécessite une photo
        if photos_count > 0:
            badges.append(ft.Container(
                content=ft.Text(f"📸 {photos_count} photo(s)", size=10, color=ft.Colors.WHITE),
                bgcolor=ft.Colors.GREEN_400,
                padding=ft.padding.symmetric(horizontal=8, vertical=3),
                border_radius=10,
                tooltip=f"{photos_count} critère(s) nécessitent une photo",
            ))

        return badges

    def _create_step_card(self, step, category_index, step_index):
        """Crée la carte d'une étape"""

        criticality_colors = {
            "Obligatoire": ft.Colors.RED_400,
            "Recommandé": ft.Colors.ORANGE_400,
            "Optionnel": ft.Colors.GREEN_400,
        }

        criticality_color = criticality_colors.get(step.get("criticite", "Recommandé"), ft.Colors.GREY)

        # Créer la liste des critères avec icônes et type de résultat
        criteres_display = []
        criteres = step.get("criteres_controle", [])
        for critere in criteres[:3]:  # Afficher max 3 critères
            if isinstance(critere, dict):
                icon = "📸 " if critere.get("photo_requise", False) else "• "
                texte = critere.get("texte", "")
                type_res = critere.get("type_resultat", "")
                # Afficher le type de résultat s'il est différent de OK/NOK
                if type_res and type_res != "OK/NOK":
                    type_badge = {
                        "Mesure": "📊",
                        "Texte": "📝",
                        "Case": "☑️"
                    }.get(type_res, "")
                    texte = f"{texte} {type_badge}"
            else:
                icon = "• "
                texte = str(critere)
            criteres_display.append(
                ft.Text(f"{icon}{texte}", size=11, color=ft.Colors.GREY_600, max_lines=1, overflow=ft.TextOverflow.ELLIPSIS)
            )

        if len(criteres) > 3:
            criteres_display.append(
                ft.Text(f"... et {len(criteres) - 3} autre(s)", size=11, color=ft.Colors.GREY_500, italic=True)
            )

        # Construire la colonne des infos avec ou sans critères
        info_column_children = [
            ft.Text(step["name"], weight=ft.FontWeight.BOLD, size=14),
            ft.Text(step.get("description", ""), size=12, color=ft.Colors.GREY_700),
        ]
        if criteres_display:
            info_column_children.append(ft.Column(criteres_display, spacing=2))

        return ft.Card(
            content=ft.Container(
                content=ft.Column([
                    ft.Row([
                        ft.Container(
                            content=ft.Icon(ft.Icons.CHECK_CIRCLE, size=16, color=criticality_color),
                            width=30,
                        ),
                        ft.Column(info_column_children, spacing=2, expand=True),
                        ft.Row([
                            ft.IconButton(
                                icon=ft.Icons.ARROW_UPWARD,
                                icon_size=18,
                                tooltip="Monter l'étape",
                                on_click=lambda e, cat_idx=category_index, step_idx=step_index:
                                    self._move_step_up(cat_idx, step_idx),
                            ),
                            ft.IconButton(
                                icon=ft.Icons.ARROW_DOWNWARD,
                                icon_size=18,
                                tooltip="Descendre l'étape",
                                on_click=lambda e, cat_idx=category_index, step_idx=step_index:
                                    self._move_step_down(cat_idx, step_idx),
                            ),
                            ft.IconButton(
                                icon=ft.Icons.DRIVE_FILE_MOVE,
                                icon_size=18,
                                tooltip="Déplacer vers une autre catégorie",
                                on_click=lambda e, cat_idx=category_index, step_idx=step_index:
                                    self._show_move_step_dialog(cat_idx, step_idx),
                            ),
                            ft.IconButton(
                                icon=ft.Icons.CONTENT_COPY,
                                icon_size=18,
                                icon_color=ft.Colors.PURPLE_400,
                                tooltip="Dupliquer l'étape",
                                on_click=lambda e, cat_idx=category_index, step_idx=step_index:
                                    self._duplicate_step(cat_idx, step_idx),
                            ),
                            ft.IconButton(
                                icon=ft.Icons.EDIT,
                                icon_size=20,
                                tooltip="Modifier l'étape",
                                on_click=lambda e, cat_idx=category_index, step_idx=step_index:
                                    self._show_edit_step_dialog(cat_idx, step_idx),
                            ),
                            ft.IconButton(
                                icon=ft.Icons.DELETE,
                                icon_size=20,
                                icon_color=ft.Colors.RED_400,
                                tooltip="Supprimer l'étape",
                                on_click=lambda e, cat_idx=category_index, step_idx=step_index:
                                    self._delete_step(cat_idx, step_idx),
                            ),
                        ], spacing=0),
                    ]),
                    # Informations supplémentaires (badges) - liste construite sans None
                    ft.Row(self._build_badges(step, criticality_color), spacing=5, wrap=True),
                ], spacing=5),
                padding=10,
            ),
        )

    def _show_add_step_dialog(self, category_index):
        """Dialogue pour ajouter une étape"""
        self._show_step_dialog(category_index, None, is_edit=False)

    def _show_edit_step_dialog(self, category_index, step_index):
        """Dialogue pour modifier une étape"""
        self._show_step_dialog(category_index, step_index, is_edit=True)

    def _show_step_dialog(self, category_index, step_index=None, is_edit=False):
        """Dialogue unifié pour ajouter/modifier une étape"""

        # Récupérer les données existantes si édition
        existing_step = None
        if is_edit and step_index is not None:
            existing_step = self.template_structure["categories"][category_index]["steps"][step_index]

        # Champs du formulaire
        name_input = ft.TextField(
            label="Nom de l'étape *",
            hint_text="Ex: Vérification des câblages",
            value=existing_step.get("name", "") if existing_step else "",
            width=700,
        )

        description_input = ft.TextField(
            label="Description",
            hint_text="Description détaillée de l'étape",
            value=existing_step.get("description", "") if existing_step else "",
            width=700,
            multiline=True,
            min_lines=3,
            max_lines=5,
        )

        # Critères de contrôle (liste de TextField avec checkbox photo et boutons de réorganisation)
        criteres_list = ft.Column(spacing=5)
        existing_criteres = existing_step.get("criteres_controle", []) if existing_step else []

        def move_critere_up(critere_row):
            """Déplacer un critère vers le haut"""
            idx = criteres_list.controls.index(critere_row)
            if idx > 0:
                criteres_list.controls.pop(idx)
                criteres_list.controls.insert(idx - 1, critere_row)
                refresh_critere_numbers()
                self.page.update()

        def move_critere_down(critere_row):
            """Déplacer un critère vers le bas"""
            idx = criteres_list.controls.index(critere_row)
            if idx < len(criteres_list.controls) - 1:
                criteres_list.controls.pop(idx)
                criteres_list.controls.insert(idx + 1, critere_row)
                refresh_critere_numbers()
                self.page.update()

        def refresh_critere_numbers():
            """Met à jour les numéros des critères"""
            for i, row in enumerate(criteres_list.controls):
                if isinstance(row, ft.Row) and len(row.controls) > 0:
                    # Le premier élément est le texte du numéro
                    row.controls[0].value = f"{i + 1}."
                    self.page.update()

        def add_critere_field(value="", photo_required=False):
            num_text = ft.Text(f"{len(criteres_list.controls) + 1}.", size=14, weight=ft.FontWeight.BOLD, width=30)

            critere_field = ft.TextField(
                hint_text="Critère de contrôle",
                value=value if isinstance(value, str) else (value.get("texte", "") if isinstance(value, dict) else ""),
                width=280,
            )

            # Type de résultat pour ce critère
            type_resultat_critere = ft.Dropdown(
                width=160,
                value=value.get("type_resultat", "OK/NOK") if isinstance(value, dict) else "OK/NOK",
                options=[
                    ft.dropdown.Option("OK/NOK"),
                    ft.dropdown.Option("Mesure"),
                    ft.dropdown.Option("Texte"),
                    ft.dropdown.Option("Case"),
                ],
                dense=True,
                content_padding=8,
            )

            photo_checkbox = ft.Checkbox(
                label="📸",
                value=photo_required if isinstance(value, str) else (value.get("photo_requise", False) if isinstance(value, dict) else False),
                tooltip="Photo requise pour ce critère",
            )

            up_btn = ft.IconButton(
                icon=ft.Icons.ARROW_UPWARD,
                icon_size=20,
                tooltip="Monter",
            )

            down_btn = ft.IconButton(
                icon=ft.Icons.ARROW_DOWNWARD,
                icon_size=20,
                tooltip="Descendre",
            )

            remove_btn = ft.IconButton(
                icon=ft.Icons.REMOVE_CIRCLE,
                icon_color=ft.Colors.RED,
                icon_size=20,
                tooltip="Supprimer ce critère",
            )

            critere_row = ft.Row([num_text, critere_field, type_resultat_critere, photo_checkbox, up_btn, down_btn, remove_btn], spacing=5)

            # Définir les actions après la création de la row
            up_btn.on_click = lambda e: move_critere_up(critere_row)
            down_btn.on_click = lambda e: move_critere_down(critere_row)
            remove_btn.on_click = lambda e: (
                criteres_list.controls.remove(critere_row),
                refresh_critere_numbers(),
                self.page.update()
            )

            criteres_list.controls.append(critere_row)
            self.page.update()

        # Ajouter les critères existants
        for critere in existing_criteres:
            if isinstance(critere, dict):
                add_critere_field(critere.get("texte", ""), critere.get("photo_requise", False))
            else:
                add_critere_field(critere, False)

        add_critere_btn = ft.ElevatedButton(
            "Ajouter un critère",
            icon=ft.Icons.ADD,
            on_click=lambda e: add_critere_field(),
        )

        # Type de résultat
        type_resultat = ft.Dropdown(
            label="Type de résultat",
            width=330,
            value=existing_step.get("type_resultat", "OK/NOK") if existing_step else "OK/NOK",
            options=[
                ft.dropdown.Option("OK/NOK"),
                ft.dropdown.Option("Mesure numérique"),
                ft.dropdown.Option("Texte libre"),
                ft.dropdown.Option("Case à cocher"),
            ],
        )

        # Criticité
        criticite = ft.Dropdown(
            label="Criticité",
            width=330,
            value=existing_step.get("criticite", "Recommandé") if existing_step else "Recommandé",
            options=[
                ft.dropdown.Option("Obligatoire"),
                ft.dropdown.Option("Recommandé"),
                ft.dropdown.Option("Optionnel"),
            ],
        )

        # Durée estimée - Extraire heures et minutes de la durée existante
        existing_duree = existing_step.get("duree_estimee", "") if existing_step else ""
        heures_val = ""
        minutes_val = ""
        if existing_duree:
            # Parser la durée existante (ex: "1h 30min" ou "45min" ou "2h")
            import re
            h_match = re.search(r'(\d+)\s*h', existing_duree)
            m_match = re.search(r'(\d+)\s*min', existing_duree)
            if h_match:
                heures_val = h_match.group(1)
            if m_match:
                minutes_val = m_match.group(1)

        duree_heures = ft.TextField(
            label="Heures",
            hint_text="0",
            value=heures_val,
            width=80,
            keyboard_type=ft.KeyboardType.NUMBER,
            input_filter=ft.NumbersOnlyInputFilter(),
        )

        duree_minutes = ft.TextField(
            label="Minutes",
            hint_text="0",
            value=minutes_val,
            width=80,
            keyboard_type=ft.KeyboardType.NUMBER,
            input_filter=ft.NumbersOnlyInputFilter(),
        )

        # Outils nécessaires
        outils_input = ft.TextField(
            label="Outils nécessaires",
            hint_text="Ex: Multimètre, Tournevis...",
            value=existing_step.get("outils", "") if existing_step else "",
            width=700,
            multiline=True,
            min_lines=2,
        )

        # Modèle de compte-rendu
        modele_cr_input = ft.TextField(
            label="Modèle de compte-rendu (optionnel)",
            hint_text="Template pré-rempli pour le CR de cette étape",
            value=existing_step.get("modele_cr", "") if existing_step else "",
            width=700,
            multiline=True,
            min_lines=3,
        )

        def save_step(e):
            if not name_input.value:
                self.snack("⚠️ Le nom de l'étape est requis")
                return

            # Récupérer les critères avec leur type de résultat et checkbox photo
            # Row contient [Num, TextField, Dropdown(type_resultat), Checkbox, Up, Down, Remove]
            criteres = []
            for row in criteres_list.controls:
                if isinstance(row, ft.Row) and len(row.controls) >= 4:
                    texte = row.controls[1].value  # TextField (index 1)
                    type_resultat_critere = row.controls[2].value  # Dropdown (index 2)
                    photo_requise = row.controls[3].value  # Checkbox (index 3)
                    if texte:
                        criteres.append({
                            "texte": texte,
                            "type_resultat": type_resultat_critere,
                            "photo_requise": photo_requise
                        })

            # Construire la durée estimée à partir des champs heures et minutes
            duree_str = ""
            if duree_heures.value:
                duree_str += f"{duree_heures.value}h"
            if duree_minutes.value:
                if duree_str:
                    duree_str += " "
                duree_str += f"{duree_minutes.value}min"

            step_data = {
                "name": name_input.value,
                "description": description_input.value,
                "criteres_controle": criteres,
                "type_resultat": type_resultat.value,
                "criticite": criticite.value,
                "duree_estimee": duree_str,
                "outils": outils_input.value,
                "modele_cr": modele_cr_input.value,
                "pieces_jointes": existing_step.get("pieces_jointes", []) if existing_step else [],
            }

            if is_edit:
                self.template_structure["categories"][category_index]["steps"][step_index] = step_data
                self.snack(f"✅ Étape '{name_input.value}' modifiée")
            else:
                self.template_structure["categories"][category_index]["steps"].append(step_data)
                self.snack(f"✅ Étape '{name_input.value}' ajoutée")

            self._refresh_categories_list()
            dialog.open = False
            self.page.update()

        # Contenu scrollable
        dialog_content = ft.Container(
            content=ft.Column([
                name_input,
                description_input,
                ft.Divider(height=10),
                ft.Text("Critères de contrôle", weight=ft.FontWeight.BOLD),
                ft.Text("Cochez 'Photo requise' si une photo est nécessaire pour valider le critère",
                        size=12, color=ft.Colors.GREY_700, italic=True),
                criteres_list,
                add_critere_btn,
                ft.Divider(height=10),
                ft.Row([type_resultat, criticite], spacing=20),
                ft.Column([
                    ft.Text("Durée estimée", weight=ft.FontWeight.BOLD, size=12),
                    ft.Row([duree_heures, duree_minutes], spacing=10),
                ], spacing=5),
                outils_input,
                modele_cr_input,
            ], spacing=10, scroll=ft.ScrollMode.AUTO),
            width=750,
            height=600,
        )

        dialog = ft.AlertDialog(
            title=ft.Text("Modifier l'étape" if is_edit else "Ajouter une étape"),
            content=dialog_content,
            actions=[
                ft.TextButton("Annuler", on_click=lambda e: self._close_dialog(dialog)),
                ft.ElevatedButton(
                    "Enregistrer" if is_edit else "Ajouter",
                    on_click=save_step,
                    style=ft.ButtonStyle(bgcolor=ft.Colors.GREEN, color=ft.Colors.WHITE),
                ),
            ],
        )

        self.page.overlay.append(dialog)
        dialog.open = True
        self.page.update()

    def _edit_category(self, category_index):
        """Modifier une catégorie"""
        category = self.template_structure["categories"][category_index]

        name_input = ft.TextField(
            label="Nom de la catégorie",
            value=category["name"],
            width=500,
        )

        # Liste d'icônes disponibles pour les catégories
        icon_options = [
            ("CHECKLIST", "📋 Liste de contrôle"),
            ("SETTINGS", "⚙️ Configuration"),
            ("VISIBILITY", "👁️ Contrôles visuels"),
            ("BUILD", "🔧 Tests mécaniques"),
            ("ELECTRICAL_SERVICES", "⚡ Tests électriques"),
            ("CABLE", "🔌 Câblage"),
            ("NETWORK_CHECK", "🌐 Tests réseau"),
            ("MEMORY", "💾 Tests électroniques"),
            ("SPEED", "⚡ Tests de performance"),
            ("SECURITY", "🔒 Sécurité"),
            ("SCIENCE", "🔬 Tests fonctionnels"),
            ("VERIFIED", "✅ Validation"),
            ("FOLDER", "📁 Documentation"),
            ("ASSESSMENT", "📝 Rapport"),
        ]

        icon_dropdown = ft.Dropdown(
            label="Icône de la catégorie",
            width=500,
            value=category.get("icon", "CHECKLIST"),
            options=[ft.dropdown.Option(key=key, text=text) for key, text in icon_options],
        )

        description_input = ft.TextField(
            label="Description",
            value=category.get("description", ""),
            width=500,
            multiline=True,
            min_lines=2,
        )

        def save_changes(e):
            if not name_input.value:
                self.snack("⚠️ Le nom est requis")
                return

            self.template_structure["categories"][category_index]["name"] = name_input.value
            self.template_structure["categories"][category_index]["icon"] = icon_dropdown.value
            self.template_structure["categories"][category_index]["description"] = description_input.value
            self._refresh_categories_list()
            self.snack("✅ Catégorie modifiée")
            dialog.open = False
            self.page.update()

        dialog = ft.AlertDialog(
            title=ft.Text("Modifier la catégorie"),
            content=ft.Column([name_input, icon_dropdown, description_input], tight=True, spacing=15),
            actions=[
                ft.TextButton("Annuler", on_click=lambda e: self._close_dialog(dialog)),
                ft.ElevatedButton("Enregistrer", on_click=save_changes),
            ],
        )

        self.page.overlay.append(dialog)
        dialog.open = True
        self.page.update()

    def _delete_category(self, category_index):
        """Supprimer une catégorie"""
        category = self.template_structure["categories"][category_index]

        def confirm(e):
            self.template_structure["categories"].pop(category_index)
            self._refresh_categories_list()
            self.snack(f"🗑️ Catégorie '{category['name']}' supprimée")
            dialog.open = False
            self.page.update()

        dialog = ft.AlertDialog(
            title=ft.Text("Confirmer la suppression"),
            content=ft.Text(f"Supprimer la catégorie '{category['name']}' et toutes ses étapes ?"),
            actions=[
                ft.TextButton("Annuler", on_click=lambda e: self._close_dialog(dialog)),
                ft.ElevatedButton(
                    "Supprimer",
                    on_click=confirm,
                    style=ft.ButtonStyle(bgcolor=ft.Colors.RED, color=ft.Colors.WHITE),
                ),
            ],
        )

        self.page.overlay.append(dialog)
        dialog.open = True
        self.page.update()

    def _move_category_up(self, category_index):
        """Déplacer une catégorie vers le haut"""
        if category_index > 0:
            categories = self.template_structure["categories"]
            categories[category_index], categories[category_index - 1] = \
                categories[category_index - 1], categories[category_index]
            self._refresh_categories_list()
            self.snack("✅ Catégorie déplacée vers le haut")

    def _move_category_down(self, category_index):
        """Déplacer une catégorie vers le bas"""
        categories = self.template_structure["categories"]
        if category_index < len(categories) - 1:
            categories[category_index], categories[category_index + 1] = \
                categories[category_index + 1], categories[category_index]
            self._refresh_categories_list()
            self.snack("✅ Catégorie déplacée vers le bas")

    def _move_step_up(self, category_index, step_index):
        """Déplacer une étape vers le haut dans sa catégorie"""
        steps = self.template_structure["categories"][category_index]["steps"]
        if step_index > 0:
            steps[step_index], steps[step_index - 1] = \
                steps[step_index - 1], steps[step_index]
            self._refresh_categories_list()
            self.snack("✅ Étape déplacée vers le haut")

    def _move_step_down(self, category_index, step_index):
        """Déplacer une étape vers le bas dans sa catégorie"""
        steps = self.template_structure["categories"][category_index]["steps"]
        if step_index < len(steps) - 1:
            steps[step_index], steps[step_index + 1] = \
                steps[step_index + 1], steps[step_index]
            self._refresh_categories_list()
            self.snack("✅ Étape déplacée vers le bas")

    def _show_move_step_dialog(self, source_category_index, step_index):
        """Dialogue pour déplacer une étape vers une autre catégorie"""
        step = self.template_structure["categories"][source_category_index]["steps"][step_index]

        # Liste des catégories disponibles (sauf la catégorie actuelle)
        category_options = []
        for i, cat in enumerate(self.template_structure["categories"]):
            if i != source_category_index:
                category_options.append(ft.dropdown.Option(key=str(i), text=cat["name"]))

        if not category_options:
            self.snack("⚠️ Aucune autre catégorie disponible")
            return

        target_category_dropdown = ft.Dropdown(
            label="Catégorie de destination",
            options=category_options,
            width=400,
        )

        def move_step(e):
            if not target_category_dropdown.value:
                self.snack("⚠️ Veuillez sélectionner une catégorie")
                return

            target_index = int(target_category_dropdown.value)

            # Retirer l'étape de la catégorie source
            moved_step = self.template_structure["categories"][source_category_index]["steps"].pop(step_index)

            # Ajouter l'étape à la catégorie cible
            self.template_structure["categories"][target_index]["steps"].append(moved_step)

            self._refresh_categories_list()
            self.snack(f"✅ Étape '{step['name']}' déplacée")
            dialog.open = False
            self.page.update()

        dialog = ft.AlertDialog(
            title=ft.Text(f"Déplacer l'étape : {step['name']}"),
            content=ft.Container(
                content=ft.Column([
                    ft.Text("Sélectionnez la catégorie de destination :"),
                    target_category_dropdown,
                ], spacing=10, tight=True),
                width=400,
            ),
            actions=[
                ft.TextButton("Annuler", on_click=lambda e: self._close_dialog(dialog)),
                ft.ElevatedButton("Déplacer", on_click=move_step),
            ],
        )

        self.page.overlay.append(dialog)
        dialog.open = True
        self.page.update()

    def _duplicate_step(self, category_index, step_index):
        """Dupliquer une étape"""
        import copy

        # Récupérer l'étape source
        source_step = self.template_structure["categories"][category_index]["steps"][step_index]

        # Créer une copie profonde de l'étape
        duplicated_step = copy.deepcopy(source_step)

        # Modifier le nom pour indiquer que c'est une copie
        duplicated_step["name"] = f"{source_step['name']} (Copie)"

        # Insérer la copie juste après l'étape source
        self.template_structure["categories"][category_index]["steps"].insert(step_index + 1, duplicated_step)

        # Rafraîchir l'affichage
        self._refresh_categories_list()
        self.snack(f"✅ Étape '{source_step['name']}' dupliquée")
        self.page.update()

    def _delete_step(self, category_index, step_index):
        """Supprimer une étape"""
        step = self.template_structure["categories"][category_index]["steps"][step_index]

        def confirm(e):
            self.template_structure["categories"][category_index]["steps"].pop(step_index)
            self._refresh_categories_list()
            self.snack(f"🗑️ Étape '{step['name']}' supprimée")
            dialog.open = False
            self.page.update()

        dialog = ft.AlertDialog(
            title=ft.Text("Confirmer la suppression"),
            content=ft.Text(f"Supprimer l'étape '{step['name']}' ?"),
            actions=[
                ft.TextButton("Annuler", on_click=lambda e: self._close_dialog(dialog)),
                ft.ElevatedButton(
                    "Supprimer",
                    on_click=confirm,
                    style=ft.ButtonStyle(bgcolor=ft.Colors.RED, color=ft.Colors.WHITE),
                ),
            ],
        )

        self.page.overlay.append(dialog)
        dialog.open = True
        self.page.update()

    def _show_json_preview(self):
        """Affiche une prévisualisation du JSON"""
        self.template_structure["updated_at"] = datetime.now().isoformat()

        json_text = json.dumps(self.template_structure, indent=2, ensure_ascii=False)

        json_display = ft.TextField(
            value=json_text,
            multiline=True,
            read_only=True,
            width=800,
            height=600,
        )

        dialog = ft.AlertDialog(
            title=ft.Text("Prévisualisation JSON"),
            content=ft.Container(
                content=json_display,
                width=850,
                height=650,
            ),
            actions=[
                ft.TextButton("Fermer", on_click=lambda e: self._close_dialog(dialog)),
                ft.ElevatedButton(
                    "Copier dans le presse-papiers",
                    icon=ft.Icons.COPY,
                    on_click=lambda e: (
                        self.page.set_clipboard(json_text),
                        self.snack("📋 JSON copié dans le presse-papiers")
                    ),
                ),
            ],
        )

        self.page.overlay.append(dialog)
        dialog.open = True
        self.page.update()

    def _handle_save(self):
        """Sauvegarde le template"""
        if not self.template_structure["categories"]:
            self.snack("⚠️ Ajoutez au moins une catégorie avant de sauvegarder")
            return

        self.template_structure["updated_at"] = datetime.now().isoformat()

        # Sauvegarder dans /data/templates/
        data_dir = Path(__file__).parent.parent / "data" / "templates"
        data_dir.mkdir(parents=True, exist_ok=True)

        # Nettoyer le nom pour créer un nom de fichier valide (sans accents ni caractères spéciaux)
        name = self.template_structure['name']
        # Normaliser et supprimer les accents
        name_normalized = unicodedata.normalize('NFKD', name).encode('ASCII', 'ignore').decode('ASCII')
        # Remplacer espaces et caractères spéciaux par underscore
        name_clean = ''.join(c if c.isalnum() else '_' for c in name_normalized)
        filename = f"{name_clean.lower()}.json"
        filepath = data_dir / filename

        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(self.template_structure, f, indent=2, ensure_ascii=False)

        self.snack(f"✅ Template sauvegardé : {filename}")

        if self.on_save:
            self.on_save(self.template_structure)

    def _handle_cancel(self):
        """Annulation"""
        if self.on_cancel:
            self.on_cancel()

    def _close_dialog(self, dialog):
        """Ferme un dialogue"""
        dialog.open = False
        self.page.update()
