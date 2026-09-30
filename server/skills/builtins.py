"""Built-in skills, read from the SKILL.md files beside this module.

Each skill is a directory under ``skills/builtin`` holding a ``SKILL.md`` in
the Agent Skills format: YAML frontmatter, then the instructions. OpenCode,
Claude Code and Codex read that same format, so one set of files serves both
ClawChat's own skill runs (where the body is the system prompt) and OpenCode
runs, which are handed the directory as a skills path.

Only the frontmatter subset these files use is parsed -- flat keys plus one
``metadata`` map of string values -- so no YAML dependency is needed.
ClawChat's skill id is the skill's name with hyphens as underscores
("code-review" is ``code_review``): ids are stored on tasks, and an Agent
Skills name allows only lowercase letters, digits and hyphens.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from skills import SkillDef, register_skill

BUILTIN_SKILLS_DIR = Path(__file__).resolve().parent / "builtin"
_NAME = re.compile(r"[a-z0-9]+(-[a-z0-9]+)*")
_BLOCK_SCALARS = {"|", "|-", "|+", ">", ">-", ">+"}


class SkillFileError(ValueError):
    """A SKILL.md that does not follow the format ClawChat reads."""


def _scalar(value: str, *, source: str) -> str:
    if value in _BLOCK_SCALARS:
        raise SkillFileError(f"{source}: block scalars are not supported; use one line")
    if value.startswith('"'):
        try:
            return json.loads(value)
        except json.JSONDecodeError as exc:
            raise SkillFileError(f"{source}: bad quoted value {value!r}") from exc
    if value.startswith("'") and value.endswith("'") and len(value) >= 2:
        return value[1:-1].replace("''", "'")
    return value


def parse_skill_file(text: str, *, source: str = "SKILL.md") -> SkillDef:
    """Read one SKILL.md into a skill definition."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise SkillFileError(f"{source}: must start with a '---' frontmatter line")
    try:
        end = next(i for i in range(1, len(lines)) if lines[i].strip() == "---")
    except StopIteration:
        raise SkillFileError(f"{source}: frontmatter is not closed with '---'") from None

    fields: dict[str, str] = {}
    metadata: dict[str, str] = {}
    in_metadata = False
    for line in lines[1:end]:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, colon, raw = line.strip().partition(":")
        if not colon:
            raise SkillFileError(f"{source}: expected 'key: value', got {line!r}")
        value = raw.strip()
        if line[:1] in (" ", "\t"):
            if not in_metadata:
                raise SkillFileError(f"{source}: only 'metadata' may hold nested keys")
            metadata[key] = _scalar(value, source=source)
        elif key == "metadata" and not value:
            in_metadata = True
        else:
            in_metadata = False
            fields[key] = _scalar(value, source=source)

    name = fields.get("name", "")
    if not _NAME.fullmatch(name) or len(name) > 64:
        raise SkillFileError(
            f"{source}: name {name!r} must be lowercase letters, digits and hyphens"
        )
    description = fields.get("description", "")
    if not description:
        raise SkillFileError(f"{source}: description is required")
    body = "\n".join(lines[end + 1 :]).strip()
    if not body:
        raise SkillFileError(f"{source}: the instructions after the frontmatter are empty")
    return SkillDef(
        id=name.replace("-", "_"),
        name=metadata.get("display-name") or name,
        description=description,
        system_prompt=body,
        output_format=metadata.get("output-format", "markdown"),
        vault_template=metadata.get("vault-template") or None,
        tags=[tag.strip() for tag in metadata.get("tags", "").split(",") if tag.strip()],
        uses_web_search=metadata.get("uses-web-search") == "true",
    )


def load_skill_dir(root: Path) -> list[SkillDef]:
    """Every ``<name>/SKILL.md`` under ``root``, in name order."""
    skills: list[SkillDef] = []
    for path in sorted(root.glob("*/SKILL.md")):
        skill = parse_skill_file(path.read_text(encoding="utf-8"), source=str(path))
        # The Agent Skills format ties the name to its directory; agents that
        # load the folder find it by that name.
        if skill.id.replace("_", "-") != path.parent.name:
            raise SkillFileError(f"{path}: name must match its directory {path.parent.name!r}")
        skills.append(skill)
    return skills


def register_builtins() -> None:
    """Register all built-in skills into the global registry."""
    skills = load_skill_dir(BUILTIN_SKILLS_DIR)
    if not skills:
        # A bundle that left the files behind would otherwise start with no
        # skills at all and fail much later, somewhere less obvious.
        raise RuntimeError(f"No built-in skills found in {BUILTIN_SKILLS_DIR}")
    for skill in skills:
        register_skill(skill)

