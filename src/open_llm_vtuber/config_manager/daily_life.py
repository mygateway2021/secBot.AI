"""Daily life configuration models.

This module defines configuration models for the Daily Life features, including
selection between offline (local) todo lists and online Microsoft To Do syncing.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from .i18n import Description, I18nMixin


class DailyLifeConfig(I18nMixin, BaseModel):
    """Daily Life feature configuration."""

    # Currently no configuration needed for offline-only daily life.
    pass

    DESCRIPTIONS = {
        "todo_backend": Description(
            en="Select todo backend (offline vs Microsoft To Do)",
            zh="选择待办后端（离线 vs Microsoft To Do）",
        ),
        "microsoft_todo": Description(
            en="Microsoft To Do settings", zh="Microsoft To Do 设置"
        ),
    }
