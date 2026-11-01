"""组件规范检查，以及 CATALOG.md 的生成。"""

from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path

from .registry import (
    CATEGORIES,
    ID_RE,
    LANGUAGE_LABELS,
    LANGUAGES,
    SEMVER_RE,
    STATUSES,
    TODO,
    catalog_path,
    component_dirs,
    load_components,
    load_toml,
    module_name,
)


def check_component(directory: Path) -> list[str]:
    cid = directory.name
    manifest = directory / "component.toml"
    if not manifest.exists():
        return ["缺少 component.toml"]
    try:
        meta = load_toml(manifest)
    except tomllib.TOMLDecodeError as error:
        return [f"component.toml 无法解析：{error}"]
    problems: list[str] = []
    if meta.get("id") != cid:
        problems.append(f"id 应为目录名 {cid!r}，实际是 {meta.get('id')!r}")
    if not ID_RE.match(cid):
        problems.append("目录名只能用小写字母、数字和连字符")
    version = str(meta.get("version", ""))
    if not SEMVER_RE.match(version):
        problems.append(f"version 必须是 x.y.z，实际是 {version!r}")
    if meta.get("status") not in STATUSES:
        problems.append(f"status 必须是 {'/'.join(STATUSES)} 之一")
    if meta.get("category") not in CATEGORIES:
        problems.append(f"category 必须是 {'/'.join(CATEGORIES)} 之一")
    if not str(meta.get("summary", "")).strip() or TODO in str(meta.get("summary", "")):
        problems.append("summary 不能为空")
    languages = meta.get("languages") or []
    if not languages or any(lang not in LANGUAGES for lang in languages):
        problems.append(f"languages 必须是 {'/'.join(LANGUAGES)} 的非空子集")
    for lang in LANGUAGES:
        if (directory / lang).is_dir() and lang not in languages:
            problems.append(f"存在 {lang}/ 目录，但 languages 里没有 {lang}")
    for name in ("README.md", "CHANGELOG.md"):
        if not (directory / name).exists():
            problems.append(f"缺少 {name}")
    readme = directory / "README.md"
    if readme.exists() and TODO in readme.read_text(encoding="utf-8"):
        problems.append(f"README.md 还有 {TODO}")
    changelog = directory / "CHANGELOG.md"
    if changelog.exists() and version:
        section = re.search(rf"^## {re.escape(version)}(?=\s)(.*?)(?=^## |\Z)", changelog.read_text(encoding="utf-8"), re.M | re.S)
        if not section:
            problems.append(f"CHANGELOG.md 没有当前版本 {version} 的小节")
        elif TODO in section.group(1):
            problems.append(f"CHANGELOG.md 的 {version} 小节还有 {TODO}")
    for index, source in enumerate(meta.get("source") or []):
        missing = [key for key in ("project", "paths", "copied") if not source.get(key)]
        if missing:
            problems.append(f"source[{index}] 缺少 {', '.join(missing)}")
    if "python" in languages:
        problems += check_python(directory / "python", cid, version)
    if "typescript" in languages:
        problems += check_typescript(directory / "typescript", cid, version)
    if meta.get("demo") is not None:
        problems += check_demo(directory, meta["demo"], languages)
    return problems


def check_python(directory: Path, cid: str, version: str) -> list[str]:
    pyproject = directory / "pyproject.toml"
    if not pyproject.exists():
        return ["python/ 缺少 pyproject.toml"]
    project = load_toml(pyproject).get("project", {})
    problems = []
    if project.get("name") != f"mykit-{cid}":
        problems.append(f"python 包名应为 mykit-{cid}")
    if project.get("version") != version:
        problems.append(f"python 版本 {project.get('version')} 与 component.toml 的 {version} 不一致")
    package = directory / "src" / "mykit" / module_name(cid)
    if not (package / "__init__.py").exists():
        problems.append(f"python 代码应放在 src/mykit/{module_name(cid)}/，并有 __init__.py")
    if (directory / "src" / "mykit" / "__init__.py").exists():
        problems.append("src/mykit/ 是共享命名空间，不能有 __init__.py")
    if not list((directory / "tests").glob("test_*.py")):
        problems.append("python/tests/ 下没有 test_*.py")
    return problems


def check_typescript(directory: Path, cid: str, version: str) -> list[str]:
    manifest = directory / "package.json"
    if not manifest.exists():
        return ["typescript/ 缺少 package.json"]
    package = json.loads(manifest.read_text(encoding="utf-8"))
    problems = []
    if package.get("name") != f"@mykit/{cid}":
        problems.append(f"npm 包名应为 @mykit/{cid}")
    if package.get("version") != version:
        problems.append(f"npm 版本 {package.get('version')} 与 component.toml 的 {version} 不一致")
    if not package.get("scripts", {}).get("test"):
        problems.append("typescript/package.json 没有 test 脚本")
    return problems


def check_demo(directory: Path, demo: dict, languages: list[str]) -> list[str]:
    problems = []
    if not isinstance(demo, dict) or not str(demo.get("entry", "")).strip():
        return ["[demo] 需要 entry，例如 entry = \"index.html\""]
    if "typescript" not in languages:
        return ["[demo] 目前只支持 TypeScript 组件（由 npm run demo:build 生成）"]
    manifest = directory / "typescript" / "package.json"
    if manifest.exists() and not json.loads(manifest.read_text(encoding="utf-8")).get("scripts", {}).get("demo:build"):
        problems.append("有 [demo] 但 typescript/package.json 没有 demo:build 脚本")
    if "height" in demo and not isinstance(demo["height"], int):
        problems.append("[demo] height 必须是整数（像素）")
    return problems


def run_check() -> tuple[dict[str, list[str]], bool]:
    """返回 (每个组件的问题, CATALOG.md 是否最新)。"""
    results = {directory.name: check_component(directory) for directory in component_dirs()}
    path = catalog_path()
    fresh = path.exists() and path.read_text(encoding="utf-8") == render_catalog()
    return results, fresh


def render_catalog() -> str:
    lines = [
        "# 组件目录",
        "",
        "由 `mykit catalog` 根据各组件的 component.toml 生成，不要手改。更好看的版本：`mykit docs`。",
        "",
        "| 组件 | 类别 | 状态 | 版本 | 语言 | 说明 | 来源 |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for component in load_components():
        projects = list(dict.fromkeys(source.get("project", "") for source in component.sources))
        cells = [
            f"[{component.id}](components/{component.id}/README.md)",
            CATEGORIES.get(component.category, component.category),
            component.status,
            component.version,
            " · ".join(LANGUAGE_LABELS[lang] for lang in component.languages),
            component.summary.replace("|", "\\|"),
            ", ".join(projects) or "原创",
        ]
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines) + "\n"


def write_catalog() -> None:
    catalog_path().write_text(render_catalog(), encoding="utf-8")
