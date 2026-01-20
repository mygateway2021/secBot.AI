"""Diary entry storage.

This module persists AI-generated diary entries to disk, grouped by character
configuration UID (conf_uid).

The frontend requests generation via WebSocket, and diary entries are stored
under the local `diary/` directory.
"""

from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime

from loguru import logger


def _is_safe_component(component: str) -> bool:
    """Return True if `component` is safe to use as a path component.

    Args:
        component: Candidate path component.

    Returns:
        True if the component is safe, otherwise False.
    """

    if not component or len(component) > 255:
        return False

    # Allow alphanumeric, underscore, hyphen, and common unicode characters.
    # Disallow filesystem special characters and path separators.
    pattern = re.compile(r"^[\w\-\u0020-\u007E\u00A0-\uFFFF]+$")
    return bool(pattern.match(component))


def _sanitize_component(component: str) -> str:
    """Sanitize a path component.

    Args:
        component: Raw component.

    Returns:
        Sanitized component.

    Raises:
        ValueError: If the component contains invalid characters.
    """

    sanitized = os.path.basename(component.strip())
    if not _is_safe_component(sanitized):
        raise ValueError(f"Invalid characters in path component: {component}")
    return sanitized


def _ensure_conf_dir(conf_uid: str) -> str:
    """Ensure the on-disk directory for a `conf_uid` exists.

    Args:
        conf_uid: Character configuration UID.

    Returns:
        The directory path for this character's diary entries.

    Raises:
        ValueError: If conf_uid is empty.
    """

    if not conf_uid:
        raise ValueError("conf_uid cannot be empty")

    safe_conf_uid = _sanitize_component(conf_uid)
    base_dir = os.path.join("diary", safe_conf_uid)
    os.makedirs(base_dir, exist_ok=True)
    return base_dir


def _get_safe_diary_path(conf_uid: str, diary_uid: str) -> str:
    """Return a sanitized diary file path.

    Args:
        conf_uid: Character configuration UID.
        diary_uid: Diary entry UID.

    Returns:
        Absolute normalized path to the diary json file.

    Raises:
        ValueError: If path traversal is detected.
    """

    safe_conf_uid = _sanitize_component(conf_uid)
    safe_diary_uid = _sanitize_component(diary_uid)

    base_dir = os.path.join("diary", safe_conf_uid)
    full_path = os.path.normpath(os.path.join(base_dir, f"{safe_diary_uid}.json"))

    # Basic traversal check.
    if not full_path.startswith(base_dir):
        raise ValueError("Invalid path: Path traversal detected")

    return full_path


def create_diary_entry(
    *,
    conf_uid: str,
    character_name: str,
    source_history_uids: list[str],
    content: str,
) -> dict:
    """Create and persist a new diary entry.

    Args:
        conf_uid: Character configuration UID.
        character_name: Display name of the character.
        source_history_uids: Chat history UIDs used to generate this entry.
        content: Generated diary content.

    Returns:
        The persisted diary entry as a dict.

    Raises:
        ValueError: If required fields are missing.
    """

    if not conf_uid:
        raise ValueError("conf_uid cannot be empty")
    if not character_name:
        raise ValueError("character_name cannot be empty")
    if not content.strip():
        raise ValueError("content cannot be empty")

    diary_uid = f"{datetime.now().strftime('%Y-%m-%d_%H-%M-%S')}_{uuid.uuid4().hex}"
    created_at = datetime.now().isoformat(timespec="seconds")

    _ensure_conf_dir(conf_uid)
    filepath = _get_safe_diary_path(conf_uid, diary_uid)

    entry = {
        "uid": diary_uid,
        "conf_uid": conf_uid,
        "character_name": character_name,
        "created_at": created_at,
        "source_history_uids": list(source_history_uids or []),
        "content": content,
    }

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(entry, f, ensure_ascii=False, indent=2)

    logger.info(
        f"Saved diary entry {diary_uid} for {conf_uid} (histories={len(source_history_uids)})"
    )

    return entry


def get_diary_entry(*, conf_uid: str, diary_uid: str) -> dict | None:
    """Load a single diary entry.

    Args:
        conf_uid: Character configuration UID.
        diary_uid: Diary entry UID.

    Returns:
        The diary entry dict if present, otherwise None.
    """

    try:
        filepath = _get_safe_diary_path(conf_uid, diary_uid)
    except ValueError:
        return None

    if not os.path.exists(filepath):
        return None

    try:
        with open(filepath, "r", encoding="utf-8") as f:
            entry = json.load(f)
        if isinstance(entry, dict) and entry.get("uid") == diary_uid:
            return entry
    except Exception as exc:
        logger.warning(f"Failed to read diary entry {filepath}: {exc}")
    return None


def update_diary_entry(
    *,
    conf_uid: str,
    diary_uid: str,
    new_content: str,
) -> dict | None:
    """Update an existing diary entry's content.

    Args:
        conf_uid: Character configuration UID.
        diary_uid: Diary entry UID.
        new_content: Updated diary content.

    Returns:
        The updated diary entry dict if successful, otherwise None.
    """

    if not new_content.strip():
        return None

    entry = get_diary_entry(conf_uid=conf_uid, diary_uid=diary_uid)
    if not entry:
        return None

    entry["content"] = new_content
    entry["updated_at"] = datetime.now().isoformat(timespec="seconds")

    try:
        filepath = _get_safe_diary_path(conf_uid, diary_uid)
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(entry, f, ensure_ascii=False, indent=2)
        return entry
    except Exception as exc:
        logger.error(f"Failed to update diary entry {conf_uid}/{diary_uid}: {exc}")
        return None


def delete_diary_entry(*, conf_uid: str, diary_uid: str) -> bool:
    """Delete an existing diary entry.

    Args:
        conf_uid: Character configuration UID.
        diary_uid: Diary entry UID.

    Returns:
        True if deleted, otherwise False.
    """

    try:
        filepath = _get_safe_diary_path(conf_uid, diary_uid)
    except ValueError:
        return False

    try:
        if os.path.exists(filepath):
            os.remove(filepath)
            return True
        return False
    except Exception as exc:
        logger.error(f"Failed to delete diary entry {conf_uid}/{diary_uid}: {exc}")
        return False


def list_diary_entries() -> list[dict]:
    """List all diary entries across all characters.

    Returns:
        A list of diary entry dicts, sorted by `created_at` descending.
    """

    base_dir = "diary"
    if not os.path.exists(base_dir):
        return []

    entries: list[dict] = []

    try:
        for conf_uid in os.listdir(base_dir):
            conf_path = os.path.join(base_dir, conf_uid)
            if not os.path.isdir(conf_path):
                continue

            # Conf dir names are created by us, but re-sanitize defensively.
            try:
                safe_conf_uid = _sanitize_component(conf_uid)
            except ValueError:
                continue

            for filename in os.listdir(conf_path):
                if not filename.endswith(".json"):
                    continue

                diary_uid = filename[:-5]
                try:
                    filepath = _get_safe_diary_path(safe_conf_uid, diary_uid)
                except ValueError:
                    continue

                try:
                    with open(filepath, "r", encoding="utf-8") as f:
                        entry = json.load(f)
                    if isinstance(entry, dict) and entry.get("uid"):
                        entries.append(entry)
                except Exception as exc:
                    logger.warning(f"Failed to read diary entry {filepath}: {exc}")

        entries.sort(key=lambda e: e.get("created_at", ""), reverse=True)
        return entries

    except Exception as exc:
        logger.error(f"Error listing diary entries: {exc}")
        return []
