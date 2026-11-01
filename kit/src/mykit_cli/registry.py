"""读取组件：component.toml、CHANGELOG.md、各语言的包定义。"""

from __future__ import annotations

import datetime
import json
import os
import re
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

CATEGORIES = {"ui": "界面", "ai": "AI / Agent", "model": "模型"}
STATUSES = {"stable": "稳定", "experimental": "实验中", "deprecated": "已弃用"}
LANGUAGES = ("python", "typescript")
LANGUAGE_LABELS = {"python": "Python", "typescript": "TS"}
ID_RE = re.compile(r"^[a-z][a-z0-9]*(-[a-z0-9]+)*$")
SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")
TODO = "（待填写）"
_CHANGELOG_HEADING = re.compile(r"^## (\d+\.\d+\.\d+)(?:\s*·\s*(\S+))?\s*$")


class KitError(Exception):
    """给用户看的错误：命令行打印后退出。"""


def root() -> Path:
    """MyKit 仓库根目录。默认是本包所在的仓库；测试时用 MYKIT_ROOT 指向副本。"""
    if os.environ.get("MYKIT_ROOT"):
        return Path(os.environ["MYKIT_ROOT"]).resolve()
    return Path(__file__).resolve().parents[3]


def components_dir() -> Path:
    return root() / "components"


def templates_dir() -> Path:
    return root() / "kit" / "templates"


def catalog_path() -> Path:
    return root() / "CATALOG.md"


def module_name(component_id: str) -> str:
    return component_id.replace("-", "_")


def today() -> str:
    return datetime.date.today().isoformat()


def load_toml(path: Path) -> dict:
    return tomllib.loads(path.read_text(encoding="utf-8"))


def version_key(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in version.split("."))


@dataclass
class ChangelogEntry:
    version: str
    date: str
    items: list[str]


def parse_changelog(text: str) -> list[ChangelogEntry]:
    entries: list[ChangelogEntry] = []
    for line in text.splitlines():
        heading = _CHANGELOG_HEADING.match(line)
        if heading:
            entries.append(ChangelogEntry(heading.group(1), heading.group(2) or "", []))
        elif entries and line.startswith("- "):
            entries[-1].items.append(line[2:].strip())
        elif entries and line.startswith("  ") and entries[-1].items:
            entries[-1].items[-1] += " " + line.strip()
    return entries


@dataclass(eq=False)
class Component:
    path: Path
    meta: dict = field(repr=False)

    @property
    def id(self) -> str:
        return self.meta["id"]

    @property
    def version(self) -> str:
        return str(self.meta["version"])

    @property
    def status(self) -> str:
        return self.meta.get("status", "")

    @property
    def category(self) -> str:
        return self.meta.get("category", "")

    @property
    def summary(self) -> str:
        return self.meta.get("summary", "")

    @property
    def languages(self) -> list[str]:
        return [lang for lang in LANGUAGES if lang in (self.meta.get("languages") or [])]

    @property
    def sources(self) -> list[dict]:
        return list(self.meta.get("source") or [])

    @property
    def demo(self) -> dict | None:
        return self.meta.get("demo")

    @property
    def python_dir(self) -> Path:
        return self.path / "python"

    @property
    def ts_dir(self) -> Path:
        return self.path / "typescript"

    @property
    def python_name(self) -> str:
        return f"mykit-{self.id}"

    @property
    def python_import(self) -> str:
        return f"mykit.{module_name(self.id)}"

    @property
    def npm_name(self) -> str:
        return f"@mykit/{self.id}"

    def python_dependencies(self) -> list[str]:
        if "python" not in self.languages:
            return []
        return list(load_toml(self.python_dir / "pyproject.toml").get("project", {}).get("dependencies", []))

    def package_json(self) -> dict:
        return json.loads((self.ts_dir / "package.json").read_text(encoding="utf-8"))

    def ts_dependencies(self) -> dict[str, str]:
        if "typescript" not in self.languages:
            return {}
        package = self.package_json()
        return {**package.get("dependencies", {}), **package.get("peerDependencies", {})}

    def changelog(self) -> list[ChangelogEntry]:
        path = self.path / "CHANGELOG.md"
        return parse_changelog(path.read_text(encoding="utf-8")) if path.exists() else []


def component_dirs() -> list[Path]:
    base = components_dir()
    if not base.is_dir():
        return []
    return sorted(path for path in base.iterdir() if path.is_dir() and not path.name.startswith("."))


def load_components() -> list[Component]:
    """能读出 component.toml 的组件，按类别、id 排序。格式问题交给 checks。"""
    found = []
    for directory in component_dirs():
        try:
            meta = load_toml(directory / "component.toml")
        except (OSError, tomllib.TOMLDecodeError):
            continue
        if meta.get("id") == directory.name:
            found.append(Component(directory, meta))
    order = list(CATEGORIES)
    found.sort(key=lambda c: (order.index(c.category) if c.category in order else len(order), c.id))
    return found


def get_component(component_id: str) -> Component:
    for component in load_components():
        if component.id == component_id:
            return component
    names = ", ".join(c.id for c in load_components())
    raise KitError(f"没有组件 {component_id!r}。现有：{names}")
