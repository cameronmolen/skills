#!/usr/bin/env python3

import os
import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / "skills"
README_PATH = REPO_ROOT / "README.md"
REPO_SLUG = os.environ.get("SKILLS_REPO", "cameronmolen/skills")

TABLE_START = "<!-- skills-table:start -->"
TABLE_END = "<!-- skills-table:end -->"


def parse_front_matter(content: str, file_path: Path) -> dict[str, str]:
    match = re.match(r"^---\n([\s\S]*?)\n---\n?", content)
    if not match:
        raise ValueError(f"{file_path} is missing YAML front matter")

    fields: dict[str, str] = {}
    for line in match.group(1).splitlines():
        field = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if not field:
            continue

        key, raw_value = field.groups()
        fields[key] = raw_value.strip().strip("\"'")

    return fields


def escape_markdown_table_cell(value: str) -> str:
    return value.replace("|", "\\|").replace("\n", " ").strip()


def summarize(description: str) -> str:
    sentences = re.findall(r"[^.!?]+[.!?]+|[^.!?]+$", re.sub(r"\s+", " ", description))
    return " ".join(sentence.strip() for sentence in sentences[:3]).strip()


def find_skills() -> list[dict[str, str]]:
    skills: list[dict[str, str]] = []

    for entry in SKILLS_DIR.iterdir():
        if not entry.is_dir() or entry.name.startswith("."):
            continue

        skill_path = entry / "SKILL.md"
        if not skill_path.exists():
            continue

        front_matter = parse_front_matter(skill_path.read_text(), skill_path)
        name = front_matter.get("name", entry.name)
        description = front_matter.get("description")

        if not description:
            raise ValueError(f"{skill_path} is missing a description")

        skills.append(
            {
                "name": name,
                "path": f"skills/{entry.name}/",
                "description": summarize(description),
            }
        )

    return sorted(skills, key=lambda skill: skill["name"])


def render_table(skills: list[dict[str, str]]) -> str:
    rows = []
    for skill in skills:
        name = escape_markdown_table_cell(skill["name"])
        description = escape_markdown_table_cell(skill["description"])
        command = f"npx skills add {REPO_SLUG} --skill {skill['name']}"
        rows.append(f"| [{name}]({skill['path']}) | {description} | `{command}` |")

    return "\n".join(
        [
            TABLE_START,
            "| Skill | Description | Add |",
            "| --- | --- | --- |",
            *rows,
            TABLE_END,
        ]
    )


def update_readme(table: str) -> None:
    existing = README_PATH.read_text() if README_PATH.exists() else "# skills\n"

    if TABLE_START in existing and TABLE_END in existing:
        updated = re.sub(
            f"{re.escape(TABLE_START)}[\\s\\S]*?{re.escape(TABLE_END)}",
            table,
            existing,
        )
    else:
        updated = f"{existing.rstrip()}\n\n## Skills\n\n{table}\n"

    README_PATH.write_text(f"{updated.rstrip()}\n")


def main() -> None:
    update_readme(render_table(find_skills()))


if __name__ == "__main__":
    main()
