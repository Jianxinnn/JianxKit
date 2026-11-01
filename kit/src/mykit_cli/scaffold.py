"""维护操作：从模板新建组件、改版本号。"""

from __future__ import annotations

import json
import re
import string
from pathlib import Path

from .checks import write_catalog
from .registry import (
    CATEGORIES,
    ID_RE,
    LANGUAGES,
    SEMVER_RE,
    TODO,
    KitError,
    components_dir,
    get_component,
    module_name,
    root,
    templates_dir,
    today,
)


def new_component(cid: str, languages: list[str], category: str, summary: str) -> list[Path]:
    errors = []
    if not ID_RE.match(cid):
        errors.append("id 只能用小写字母、数字和连字符，例如 pdb-io")
    if (components_dir() / cid).exists():
        errors.append(f"components/{cid} 已存在")
    if category not in CATEGORIES:
        errors.append(f"类别必须是 {'/'.join(CATEGORIES)} 之一")
    if not languages or any(lang not in LANGUAGES for lang in languages):
        errors.append(f"语言必须是 {','.join(LANGUAGES)} 的子集")
    if not summary.strip():
        errors.append("需要一句话说明（--summary）")
    if errors:
        raise KitError("\n".join(errors))
    values = {
        "id": cid,
        "module": module_name(cid),
        "category": category,
        "summary": summary,
        "summary_toml": json.dumps(summary, ensure_ascii=False),
        "languages_toml": json.dumps(languages),
        "date": today(),
        "todo": TODO,
    }
    templates = templates_dir()
    sources = [path for path in (templates / "common").rglob("*") if path.is_file()]
    for lang in languages:
        sources += [path for path in (templates / lang).rglob("*") if path.is_file()]
    target = components_dir() / cid
    created = []
    for source in sources:
        if source.name == ".DS_Store":
            continue
        relative = source.relative_to(templates)
        relative = Path(*relative.parts[1:]) if relative.parts[0] == "common" else relative
        path = target / string.Template(str(relative)).substitute(values)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(string.Template(source.read_text(encoding="utf-8")).substitute(values), encoding="utf-8")
        created.append(path.relative_to(root()))
    write_catalog()
    return sorted(created)


def _replace_version(path: Path, pattern: str, old: str, new: str) -> str:
    text = path.read_text(encoding="utf-8")
    updated, count = re.subn(pattern.format(re.escape(old)), lambda m: m.group(0).replace(old, new), text, count=1, flags=re.M)
    if count != 1:
        raise KitError(f"{path.relative_to(root())} 里找不到版本 {old}")
    return updated


def bump_component(cid: str, version: str) -> tuple[str, list[Path]]:
    """同步改 component.toml、pyproject.toml、package.json，并在 CHANGELOG.md 顶部加一节。返回 (旧版本, 改动的文件)。"""
    component = get_component(cid)
    if not SEMVER_RE.match(version):
        raise KitError("版本号必须是 x.y.z")
    old = component.version
    if old == version:
        raise KitError(f"{cid} 已经是 {old}")
    # 先全部算好再写，任何一处找不到版本号都不会留下改了一半的文件
    updates = {component.path / "component.toml": _replace_version(component.path / "component.toml", r'^version = "{}"', old, version)}
    if "python" in component.languages:
        path = component.python_dir / "pyproject.toml"
        updates[path] = _replace_version(path, r'^version = "{}"', old, version)
    if "typescript" in component.languages:
        path = component.ts_dir / "package.json"
        updates[path] = _replace_version(path, r'^  "version": "{}"', old, version)
    changelog = component.path / "CHANGELOG.md"
    text = changelog.read_text(encoding="utf-8")
    entry = f"## {version} · {today()}\n\n- {TODO}\n\n"
    first = re.search(r"^## ", text, re.M)
    updates[changelog] = text[: first.start()] + entry + text[first.start():] if first else text.rstrip("\n") + "\n\n" + entry
    for path, content in updates.items():
        path.write_text(content, encoding="utf-8")
    write_catalog()
    return old, [path.relative_to(root()) for path in updates]
