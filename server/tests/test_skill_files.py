"""Built-in skills live as Agent Skills SKILL.md files."""

import re

import pytest

from skills import get_all_skills, get_skill
from skills.builtins import (
    BUILTIN_SKILLS_DIR,
    SkillFileError,
    load_skill_dir,
    parse_skill_file,
)

BUILTIN_IDS = {
    "code_review",
    "data_analysis",
    "draft",
    "obsidian_sync",
    "plan",
    "prioritize",
    "research",
    "summarize",
    "weekly_review",
}


def test_builtins_load_from_their_skill_files():
    assert {skill.id for skill in get_all_skills()} == BUILTIN_IDS
    assert {skill.id for skill in load_skill_dir(BUILTIN_SKILLS_DIR)} == BUILTIN_IDS

    research = get_skill("research")
    assert research.uses_web_search is True
    assert research.vault_template == "{project}/Research/{title}_{date}.md"
    assert research.system_prompt.startswith("You are a research assistant.")
    review = get_skill("code_review")
    assert review.name == "Code Review"
    assert review.tags == ["analysis", "development"]
    assert review.uses_web_search is False
    assert get_skill("prioritize").output_format == "checklist"
    assert get_skill("summarize").vault_template is None


def test_skill_files_keep_metadata_values_as_strings():
    """Agent Skills metadata is string-to-string; a bare true would be a bool."""
    for path in BUILTIN_SKILLS_DIR.glob("*/SKILL.md"):
        frontmatter = path.read_text(encoding="utf-8").split("---")[1]
        for line in frontmatter.splitlines():
            value = line.partition(":")[2].strip()
            assert not re.fullmatch(r"(?i)true|false|yes|no|null|~|[0-9.]+", value), (
                f"{path}: quote {line.strip()!r}"
            )


def test_parse_reads_quoted_values_and_metadata():
    skill = parse_skill_file(
        "---\n"
        "name: release-notes\n"
        'description: "Write notes: what changed, and why"\n'
        "metadata:\n"
        "  display-name: Release Notes\n"
        '  vault-template: "{project}/Notes/{date}.md"\n'
        "  tags: writing, release\n"
        '  uses-web-search: "true"\n'
        "---\n\n"
        "Write the notes.\n"
    )
    assert skill.id == "release_notes"
    assert skill.name == "Release Notes"
    assert skill.description == "Write notes: what changed, and why"
    assert skill.vault_template == "{project}/Notes/{date}.md"
    assert skill.tags == ["writing", "release"]
    assert skill.uses_web_search is True
    assert skill.system_prompt == "Write the notes."


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("name: x\n", "must start"),
        ("---\nname: x\ndescription: y\n", "not closed"),
        ("---\nname: code_review\ndescription: y\n---\nbody", "lowercase letters"),
        ("---\nname: x\n---\nbody", "description is required"),
        ("---\nname: x\ndescription: y\n---\n", "empty"),
        ("---\nname: x\ndescription: >\n  folded\n---\nbody", "block scalars"),
        ("---\nname: x\n  stray: y\ndescription: y\n---\nbody", "nested keys"),
    ],
)
def test_parse_rejects_what_it_cannot_read(text, message):
    with pytest.raises(SkillFileError, match=message):
        parse_skill_file(text)


def test_skill_name_must_match_its_directory(tmp_path):
    (tmp_path / "draft").mkdir()
    (tmp_path / "draft" / "SKILL.md").write_text(
        "---\nname: drafting\ndescription: y\n---\nbody", encoding="utf-8"
    )
    with pytest.raises(SkillFileError, match="must match its directory"):
        load_skill_dir(tmp_path)

