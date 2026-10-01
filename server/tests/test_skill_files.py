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


# --- mcp-servers allowlist ---------------------------------------------------


def _skill(mcp_servers_line: str = "") -> str:
    return (
        "---\nname: notes-digest\ndescription: y\n"
        + (f"metadata:\n  mcp-servers: {mcp_servers_line}\n" if mcp_servers_line else "")
        + "---\nbody"
    )


@pytest.mark.parametrize(
    ("line", "expected"),
    [
        ("", None),
        ('"*"', None),
        ("none", ()),
        ("notion, github__search", ("notion", "github__search")),
    ],
)
def test_mcp_servers_names_whole_servers_or_single_tools(line, expected):
    assert parse_skill_file(_skill(line)).mcp_servers == expected


@pytest.mark.parametrize("line", ['""', '"notion, *"', '"none, notion"'])
def test_mcp_servers_rejects_an_ambiguous_list(line):
    with pytest.raises(SkillFileError, match="mcp-servers"):
        parse_skill_file(_skill(line))


def test_builtins_are_offered_every_server():
    assert all(skill.mcp_servers is None for skill in get_all_skills())


# --- the user's own skills ---------------------------------------------------


def _write_skill(root, name: str, body: str = "---\nname: {name}\ndescription: y\n---\nbody"):
    (root / name).mkdir()
    (root / name / "SKILL.md").write_text(body.format(name=name), encoding="utf-8")


def test_user_skills_load_one_at_a_time_and_a_bad_file_costs_only_itself(tmp_path, caplog):
    from skills.builtins import load_user_skills

    _write_skill(tmp_path, "notion-digest")
    _write_skill(tmp_path, "broken", body="name: {name}\n")  # no frontmatter
    _write_skill(tmp_path, "renamed", body="---\nname: other\ndescription: y\n---\nbody")

    with caplog.at_level("WARNING"):
        loaded = load_user_skills(tmp_path)

    assert [skill.id for skill in loaded] == ["notion_digest"]
    assert "broken" in caplog.text and "must match its directory" in caplog.text
    assert load_user_skills(tmp_path / "missing") == []


def test_user_skills_register_over_builtins_of_the_same_name(tmp_path):
    from skills import SKILL_REGISTRY
    from skills.builtins import register_builtins, register_user_skills

    _write_skill(
        tmp_path,
        "draft",
        body=(
            "---\nname: draft\ndescription: House style\nmetadata:\n"
            "  mcp-servers: notion\n---\nDraft it our way."
        ),
    )
    try:
        registered = register_user_skills(tmp_path)
        assert [skill.id for skill in registered] == ["draft"]
        draft = get_skill("draft")
        assert draft.system_prompt == "Draft it our way."
        assert draft.mcp_servers == ("notion",)
        assert set(SKILL_REGISTRY) == BUILTIN_IDS
    finally:
        register_builtins()
    assert get_skill("draft").system_prompt != "Draft it our way."
