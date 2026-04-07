"""
Parser RAC Excel (XLSX) pour R#BD.

Ce module parse un classeur RAC sans dépendance externe (stdlib uniquement),
avec les objectifs suivants:
1) Valider la présence d'un onglet contenant "RAC".
2) Extraire les colonnes métier clés (B..E+G, H..M, P..AA, AB, AE).
3) Extraire les groupes équipements par blocs de 3 colonnes à partir de AF.
4) Produire une structure JSON normalisée et traçable.

Important:
- Ce parser ne fait pas de persistance disque.
- La persistance est gérée par RACManager.
"""

from __future__ import annotations

import re
import zipfile
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, List, Tuple
from xml.etree import ElementTree as ET


class RACWorkbookValidationError(ValueError):
    """Erreur de validation d'un fichier RAC importé."""


class RACExcelParser:
    """
    Parser métier pour classeurs RAC.

    Le parser cible le format XLSX OOXML et lit:
    - workbook.xml / workbook.rels pour trouver les onglets,
    - sharedStrings.xml pour résoudre les cellules de type string indexée,
    - worksheet XML pour lire les lignes et colonnes.
    """

    NS_MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    NS_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
    NS_PKG_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"

    # Colonnes principales demandées par le métier
    COL_OPTIONS = [2, 3, 4, 5, 7]  # B..E + G
    COL_TERMINAL = {
        "terminal_name": 8,      # H
        "terminal_number": 9,    # I
        "signal_label": 10,      # J
        "signal_type": 11,       # K
        "polarity_name": 12,     # L
    }
    COL_INTERMEDIATE = {
        "polarity_origin": 19,   # S
        "source": 21,            # U
        "signal_label": 22,      # V (fallback J)
        "signal_type": 23,       # W (fallback K)
        "polarity_name": 24,     # X (fallback L)
        "female_socket": 25,     # Y
        "socket_index": 26,      # Z
        "socket_terminal": 27,   # AA
    }
    COL_REVISION = 28             # AB
    COL_EQUIPMENTS = 31           # AE
    COL_GROUP_START = 32          # AF

    def parse(self, filename: str, file_content: bytes) -> Dict[str, Any]:
        """
        Valider et parser un fichier RAC XLSX.

        Args:
            filename: nom du fichier importé.
            file_content: contenu binaire du fichier.

        Returns:
            Dictionnaire JSON normalisé.

        Raises:
            RACWorkbookValidationError: si fichier invalide ou onglet RAC absent.
        """
        safe_name = Path(filename).name
        ext = Path(safe_name).suffix.lower()

        if ext not in {".xlsx", ".xlsm"}:
            raise RACWorkbookValidationError(
                "Format RAC non supporte. Utiliser un fichier Excel .xlsx ou .xlsm."
            )

        archive = self._open_archive(file_content)
        shared_strings = self._load_shared_strings(archive)
        sheet_name, sheet_path = self._find_rac_sheet(archive)

        rows = self._load_sheet_rows(archive, sheet_path, shared_strings)
        if not rows:
            raise RACWorkbookValidationError(
                "L'onglet RAC est vide ou illisible (aucune ligne exploitable)."
            )

        row1 = rows.get(1, {})
        row2 = rows.get(2, {})
        max_col = self._get_max_col_index(rows)

        equipment_groups = self._build_equipment_groups(row1, row2, max_col)
        parsed_rows, skipped_rows = self._parse_data_rows(rows, row2, equipment_groups, max_col)

        return {
            "parser_version": "rac_excel_parser_v1",
            "source": {
                "filename": safe_name,
                "parsed_at": datetime.now().isoformat(),
                "sheet_name": sheet_name,
            },
            "summary": {
                "rows_detected": len(rows),
                "rows_parsed": len(parsed_rows),
                "rows_skipped": skipped_rows,
                "max_column_index": max_col,
                "max_column_letter": self._col_index_to_letter(max_col),
                "equipment_group_count": len(equipment_groups),
            },
            "headers": {
                "line_1": self._row_to_letter_map(row1),
                "line_2": self._row_to_letter_map(row2),
            },
            "equipment_groups": equipment_groups,
            "records": parsed_rows,
        }

    # ------------------------------------------------------------------
    # Parsing du workbook XLSX
    # ------------------------------------------------------------------

    def _open_archive(self, file_content: bytes) -> zipfile.ZipFile:
        """Ouvrir le ZIP XLSX de manière sûre."""
        try:
            return zipfile.ZipFile(BytesIO(file_content), "r")
        except zipfile.BadZipFile as exc:
            raise RACWorkbookValidationError("Le fichier importé n'est pas un classeur XLSX valide.") from exc

    def _find_rac_sheet(self, archive: zipfile.ZipFile) -> Tuple[str, str]:
        """Trouver le premier onglet contenant 'RAC' (insensible casse)."""
        workbook_xml = ET.fromstring(archive.read("xl/workbook.xml"))
        rels_xml = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))

        rel_map = {
            rel.attrib.get("Id", ""): rel.attrib.get("Target", "")
            # workbook.xml.rels utilise le namespace "package relationships".
            for rel in rels_xml.findall(f"{self.NS_PKG_REL}Relationship")
        }

        for sheet in workbook_xml.findall(f"{self.NS_MAIN}sheets/{self.NS_MAIN}sheet"):
            sheet_name = sheet.attrib.get("name", "")
            if "rac" not in sheet_name.lower():
                continue

            rel_id = sheet.attrib.get(f"{self.NS_REL}id", "")
            target = rel_map.get(rel_id, "")
            if not target:
                continue

            if not target.startswith("xl/"):
                target = f"xl/{target}"

            return sheet_name, target

        raise RACWorkbookValidationError(
            "Aucun onglet contenant 'RAC' n'a ete trouve dans le classeur."
        )

    def _load_shared_strings(self, archive: zipfile.ZipFile) -> List[str]:
        """Charger sharedStrings.xml si présent."""
        path = "xl/sharedStrings.xml"
        if path not in archive.namelist():
            return []

        root = ET.fromstring(archive.read(path))
        strings: List[str] = []
        for item in root.findall(f"{self.NS_MAIN}si"):
            text = "".join((node.text or "") for node in item.iter(f"{self.NS_MAIN}t"))
            strings.append(self._clean(text))
        return strings

    def _load_sheet_rows(
        self,
        archive: zipfile.ZipFile,
        sheet_path: str,
        shared_strings: List[str],
    ) -> Dict[int, Dict[int, str]]:
        """Charger la feuille RAC en dictionnaire rows[row_index][col_index] = valeur."""
        root = ET.fromstring(archive.read(sheet_path))
        sheet_data = root.find(f"{self.NS_MAIN}sheetData")
        if sheet_data is None:
            return {}

        rows: Dict[int, Dict[int, str]] = {}
        for row in sheet_data.findall(f"{self.NS_MAIN}row"):
            row_idx = int(row.attrib.get("r", "0") or 0)
            if row_idx <= 0:
                continue

            row_values: Dict[int, str] = {}
            for cell in row.findall(f"{self.NS_MAIN}c"):
                ref = cell.attrib.get("r", "")
                col_idx = self._col_ref_to_index(ref)
                if col_idx <= 0:
                    continue

                value = self._read_cell_value(cell, shared_strings)
                if value != "":
                    row_values[col_idx] = value

            if row_values:
                rows[row_idx] = row_values

        return rows

    def _read_cell_value(self, cell: ET.Element, shared_strings: List[str]) -> str:
        """Lire une valeur de cellule OOXML en texte."""
        cell_type = cell.attrib.get("t", "")
        value_node = cell.find(f"{self.NS_MAIN}v")
        inline_node = cell.find(f"{self.NS_MAIN}is")

        if cell_type == "s" and value_node is not None:
            # String indexée dans sharedStrings
            try:
                idx = int(value_node.text or "0")
                return self._clean(shared_strings[idx]) if 0 <= idx < len(shared_strings) else ""
            except (ValueError, IndexError):
                return ""

        if cell_type == "inlineStr" and inline_node is not None:
            text = "".join((node.text or "") for node in inline_node.iter(f"{self.NS_MAIN}t"))
            return self._clean(text)

        # Valeur brute (nombre, booléen, string littérale)
        return self._clean(value_node.text if value_node is not None else "")

    # ------------------------------------------------------------------
    # Parsing métier des lignes
    # ------------------------------------------------------------------

    def _parse_data_rows(
        self,
        rows: Dict[int, Dict[int, str]],
        row2_headers: Dict[int, str],
        equipment_groups: List[Dict[str, Any]],
        max_col: int,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """Parser les lignes métier (>= 3) en enregistrements normalisés."""
        parsed: List[Dict[str, Any]] = []
        skipped = 0

        for row_idx in sorted(rows.keys()):
            if row_idx < 3:
                continue

            row = rows.get(row_idx, {})
            if not row:
                skipped += 1
                continue

            record = self._build_record(row_idx, row, row2_headers, equipment_groups, max_col)
            if record is None:
                skipped += 1
                continue

            parsed.append(record)

        return parsed, skipped

    def _build_record(
        self,
        row_idx: int,
        row: Dict[int, str],
        row2_headers: Dict[int, str],
        equipment_groups: List[Dict[str, Any]],
        max_col: int,
    ) -> Dict[str, Any] | None:
        """Construire un enregistrement RAC normalisé pour une ligne Excel."""
        # Valeurs primaires (fond d'armoire)
        j_label = row.get(self.COL_TERMINAL["signal_label"], "")
        k_type = row.get(self.COL_TERMINAL["signal_type"], "")
        l_polarity = row.get(self.COL_TERMINAL["polarity_name"], "")

        # Valeurs fallback (intermédiaire)
        v_label = row.get(self.COL_INTERMEDIATE["signal_label"], "")
        w_type = row.get(self.COL_INTERMEDIATE["signal_type"], "")
        x_polarity = row.get(self.COL_INTERMEDIATE["polarity_name"], "")

        signal_label = j_label or v_label
        signal_type = k_type or w_type
        polarity_name = l_polarity or x_polarity

        selected_options = self._extract_selected_options(row, row2_headers)
        equipment_targets = self._split_equipment_targets(row.get(self.COL_EQUIPMENTS, ""))
        equipment_connections = self._extract_equipment_connections(row, equipment_groups)

        female_socket = row.get(self.COL_INTERMEDIATE["female_socket"], "")
        embases = self._build_embases(female_socket, row.get(self.COL_INTERMEDIATE["socket_index"], ""))

        # Filtre anti-bruit: ignorer les lignes réellement vides de sens métier.
        has_core_data = any(
            [
                row.get(self.COL_TERMINAL["terminal_name"], ""),
                row.get(self.COL_TERMINAL["terminal_number"], ""),
                signal_label,
                signal_type,
                polarity_name,
                row.get(self.COL_INTERMEDIATE["source"], ""),
                female_socket,
                equipment_targets,
                equipment_connections,
            ]
        )
        if not has_core_data:
            return None

        raw_columns = self._extract_raw_columns(row, max_col)

        return {
            "excel_row": row_idx,
            "options": selected_options,
            "terminal_board": {
                "name": row.get(self.COL_TERMINAL["terminal_name"], ""),
                "terminal": row.get(self.COL_TERMINAL["terminal_number"], ""),
                "signal_label": signal_label,
                "signal_type": signal_type,
                "polarity_name": polarity_name,
                "signal_label_source": "J" if j_label else ("V" if v_label else ""),
                "signal_type_source": "K" if k_type else ("W" if w_type else ""),
                "polarity_source": "L" if l_polarity else ("X" if x_polarity else ""),
            },
            "intermediate_path": {
                "polarity_origin": row.get(self.COL_INTERMEDIATE["polarity_origin"], ""),
                "source": row.get(self.COL_INTERMEDIATE["source"], ""),
                "female_socket": female_socket,
                "socket_index": row.get(self.COL_INTERMEDIATE["socket_index"], ""),
                "socket_terminal": row.get(self.COL_INTERMEDIATE["socket_terminal"], ""),
                "embases": embases,
            },
            "target_equipment_types": equipment_targets,
            "equipment_connections": equipment_connections,
            "revision_tag": row.get(self.COL_REVISION, ""),
            "raw": raw_columns,
        }

    def _extract_selected_options(
        self,
        row: Dict[int, str],
        row2_headers: Dict[int, str],
    ) -> List[Dict[str, str]]:
        """Extraire les options sélectionnées en colonnes B..E + G."""
        selected: List[Dict[str, str]] = []
        for col_idx in self.COL_OPTIONS:
            value = row.get(col_idx, "")
            if value == "":
                continue

            selected.append(
                {
                    "column": self._col_index_to_letter(col_idx),
                    "label": row2_headers.get(col_idx, ""),
                    "value": value,
                }
            )

        return selected

    def _extract_equipment_connections(
        self,
        row: Dict[int, str],
        equipment_groups: List[Dict[str, Any]],
    ) -> List[Dict[str, str]]:
        """Extraire les terminaisons vers équipements finaux (groupes de 3 colonnes)."""
        connections: List[Dict[str, str]] = []

        for group in equipment_groups:
            start = group["start_col_index"]
            card_number = row.get(start, "")
            card_type = row.get(start + 1, "")
            card_terminal = row.get(start + 2, "")

            if not any([card_number, card_type, card_terminal]):
                continue

            connections.append(
                {
                    "equipment_header": group["header_line_1"],
                    "equipment_type": group["equipment_type"],
                    "vendor": group["vendor"],
                    "card_number": card_number,
                    "card_type": card_type,
                    "card_terminal": card_terminal,
                }
            )

        return connections

    def _build_equipment_groups(
        self,
        row1: Dict[int, str],
        row2: Dict[int, str],
        max_col: int,
    ) -> List[Dict[str, Any]]:
        """Construire la description des groupes équipements (AF..)."""
        groups: List[Dict[str, Any]] = []
        start = self.COL_GROUP_START

        while start <= max_col:
            head_1 = row1.get(start, "")
            head_2_col1 = row2.get(start, "")
            head_2_col2 = row2.get(start + 1, "")
            head_2_col3 = row2.get(start + 2, "")

            # On garde le groupe si au moins un libellé est présent.
            if any([head_1, head_2_col1, head_2_col2, head_2_col3]):
                equipment_type, vendor = self._parse_equipment_header(head_1)
                groups.append(
                    {
                        "start_col_index": start,
                        "start_col_letter": self._col_index_to_letter(start),
                        "header_line_1": head_1,
                        "line_2": {
                            self._col_index_to_letter(start): head_2_col1,
                            self._col_index_to_letter(start + 1): head_2_col2,
                            self._col_index_to_letter(start + 2): head_2_col3,
                        },
                        "equipment_type": equipment_type,
                        "vendor": vendor,
                    }
                )

            start += 3

        return groups

    def _build_embases(self, female_socket: str, socket_index: str) -> List[Dict[str, str]]:
        """Construire la liste des embases depuis la colonne Y."""
        if female_socket == "":
            return []

        # Cas attendu: "DE-SCU1 / DE-SCU2"
        values = [self._clean(part) for part in female_socket.split("/") if self._clean(part)]
        embases: List[Dict[str, str]] = []
        for idx, value in enumerate(values, start=1):
            embases.append(
                {
                    "name": value,
                    "position": str(idx),
                    "index": socket_index,
                }
            )
        return embases

    def _split_equipment_targets(self, cell_value: str) -> List[str]:
        """
        Split robuste de la colonne AE (types d'équipement).

        Gère plusieurs séparateurs possibles: '/', ',', ';', 'et', 'ou'.
        """
        text = self._clean(cell_value)
        if text == "":
            return []

        parts = re.split(r"\s*(?:/|,|;|\bet\b|\bou\b)\s*", text, flags=re.IGNORECASE)
        return [self._clean(part) for part in parts if self._clean(part)]

    # ------------------------------------------------------------------
    # Helpers colonnes / valeurs
    # ------------------------------------------------------------------

    def _extract_raw_columns(self, row: Dict[int, str], max_col: int) -> Dict[str, str]:
        """Conserver une vue brute COL->valeur pour traçabilité."""
        raw: Dict[str, str] = {}
        for idx, value in row.items():
            if idx <= max_col and value != "":
                raw[self._col_index_to_letter(idx)] = value
        return raw

    def _row_to_letter_map(self, row: Dict[int, str]) -> Dict[str, str]:
        """Convertir une ligne indexée en mapping lettre->valeur."""
        output: Dict[str, str] = {}
        for idx in sorted(row.keys()):
            val = row.get(idx, "")
            if val != "":
                output[self._col_index_to_letter(idx)] = val
        return output

    def _get_max_col_index(self, rows: Dict[int, Dict[int, str]]) -> int:
        """Trouver l'index max de colonne non vide dans la feuille."""
        max_col = 0
        for row in rows.values():
            if row:
                row_max = max(row.keys())
                if row_max > max_col:
                    max_col = row_max
        return max_col

    def _parse_equipment_header(self, header: str) -> Tuple[str, str]:
        """Parser l'entête ligne 1 du groupe équipement: ex 'SCU INEO'."""
        normalized = self._clean(header)
        if normalized == "":
            return "", ""

        parts = normalized.split()
        if len(parts) == 1:
            return parts[0], ""

        return parts[0], " ".join(parts[1:])

    def _col_ref_to_index(self, ref: str) -> int:
        """Convertir une référence cellule (ex: AF12) en index colonne 32."""
        letters = "".join(char for char in ref if char.isalpha())
        return self._col_letters_to_index(letters)

    def _col_letters_to_index(self, letters: str) -> int:
        """Convertir 'AF' -> 32."""
        if letters == "":
            return 0

        idx = 0
        for char in letters.upper():
            idx = idx * 26 + (ord(char) - 64)
        return idx

    def _col_index_to_letter(self, index: int) -> str:
        """Convertir 32 -> 'AF'."""
        if index <= 0:
            return ""

        letters = ""
        value = index
        while value > 0:
            value, rem = divmod(value - 1, 26)
            letters = chr(65 + rem) + letters
        return letters

    def _clean(self, value: Any) -> str:
        """Nettoyer et normaliser une valeur texte."""
        if value is None:
            return ""

        text = str(value)
        text = text.replace("\u00a0", " ")
        text = re.sub(r"\s+", " ", text)
        return text.strip()
