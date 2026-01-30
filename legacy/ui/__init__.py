# ui/__init__.py
"""
Module UI pour R#BD
Contient les composants d'interface utilisateur
"""

from .header import create_header
from .template_visites_view import TemplateVisitesView
from .template_editor_view import TemplateEditorView

__all__ = ["create_header", "TemplateVisitesView", "TemplateEditorView"]
