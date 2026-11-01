"""把组件装进使用方项目（mykit add），以及找出项目里已经装了哪些组件（mykit outdated）。

两种装法：
- 链接（默认）：Python 用可编辑安装，TypeScript 用本地路径。组件库一改，项目里立刻生效。
- 锁定（--pin）：把当前版本打成 wheel / tgz 放进项目的 vendor/mykit/，项目从这个文件安装。
  文件跟项目一起提交，换机器、上集群都不需要访问 MyKit；升级时再 pin 一次。
"""

from __future__ import annotations

import json
import os
import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path

from .checks import check_component
from .registry import Component, KitError, LANGUAGE_LABELS, load_toml, module_name, root

VENDOR = Path("vendor") / "mykit"


@dataclass
class Step:
    command: list[str]
    cwd: Path
    note: str = ""


@dataclass
class Plan:
    component: Component
    languages: list[str]
    pinned: bool
    make_dirs: list[Path] = field(default_factory=list)
    steps: list[Step] = field(default_factory=list)
    remove_after: list[Path] = field(default_factory=list)  # 旧版本的 vendor 文件，安装成功后删掉


def project_languages(project: Path) -> list[str]:
    found = []
    if (project / "pyproject.toml").exists():
        found.append("python")
    if (project / "package.json").exists():
        found.append("typescript")
    return found


def _relative(target: Path, start: Path) -> str:
    """相对路径，方便项目和 MyKit 一起搬家；两者只在家目录或根目录才有共同上级时用绝对路径。"""
    target, start = target.resolve(), start.resolve()
    common = Path(os.path.commonpath([target, start]))
    if common in (Path(common.anchor), Path.home().resolve()):
        return str(target)
    path = os.path.relpath(target, start)
    return path if path.startswith(".") else f"./{path}"


def _inside(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def choose_languages(component: Component, project: Path, requested: str | None) -> list[str]:
    available = project_languages(project)
    if requested:
        wanted = [lang.strip() for lang in requested.split(",") if lang.strip()]
        unsupported = [lang for lang in wanted if lang not in component.languages]
        if unsupported:
            raise KitError(f"{component.id} 没有 {', '.join(unsupported)} 实现（有：{', '.join(component.languages)}）")
        missing = [lang for lang in wanted if lang not in available]
        if missing:
            files = {"python": "pyproject.toml", "typescript": "package.json"}
            raise KitError(f"当前目录没有 {', '.join(files[lang] for lang in missing)}，先初始化项目（uv init / npm init）")
        return wanted
    usable = [lang for lang in component.languages if lang in available]
    if not usable:
        need = " 或 ".join({"python": "pyproject.toml", "typescript": "package.json"}[lang] for lang in component.languages)
        raise KitError(f"{component.id} 需要 {need}；当前目录没有。请在项目根目录运行，或先 uv init / npm init")
    if len(usable) > 1:
        raise KitError(f"{component.id} 同时有 Python 和 TS 实现，项目里两种都有；用 --lang python 或 --lang typescript 指定")
    return usable


def plan_add(component: Component, project: Path, *, pin: bool = False, lang: str | None = None) -> Plan:
    project = project.resolve()
    if _inside(project, root()):
        raise KitError("请在使用方项目里运行 mykit add，不要在 MyKit 仓库里")
    if pin:
        problems = check_component(component.path)
        if problems:
            raise KitError(f"{component.id} 没通过 mykit check，不能锁定版本：\n  - " + "\n  - ".join(problems))
    plan = Plan(component, choose_languages(component, project, lang), pin)
    for language in plan.languages:
        (_plan_python if language == "python" else _plan_typescript)(plan, project)
    return plan


def _stale(vendor: Path, pattern: str, keep: str) -> list[Path]:
    regex = re.compile(pattern)
    return sorted(path for path in vendor.glob("*") if regex.fullmatch(path.name) and path.name != keep) if vendor.is_dir() else []


def _plan_python(plan: Plan, project: Path) -> None:
    component = plan.component
    if not plan.pinned:
        plan.steps.append(Step(["uv", "add", "--editable", _relative(component.python_dir, project)], project, "可编辑安装"))
        return
    vendor = project / VENDOR
    wheel = f"{module_name(component.python_name)}-{component.version}-py3-none-any.whl"
    plan.make_dirs.append(vendor)
    plan.steps.append(Step(["uv", "build", "--package", component.python_name, "--wheel", "--out-dir", str(vendor)], root(), "打包 wheel"))
    plan.steps.append(Step(["uv", "add", _relative(vendor / wheel, project)], project, "从 wheel 安装"))
    plan.remove_after += _stale(vendor, rf"{re.escape(module_name(component.python_name))}-\d+\.\d+\.\d+-py3-none-any\.whl", wheel)
    # uv build 会在输出目录写一个内容为 * 的 .gitignore，那样 wheel 提交不进 git
    plan.remove_after.append(vendor / ".gitignore")


def _plan_typescript(plan: Plan, project: Path) -> None:
    component = plan.component
    package = component.package_json()
    tool = "pnpm" if (project / "pnpm-lock.yaml").exists() else "npm"
    verb = "add" if tool == "pnpm" else "install"
    # 组件对 peer 依赖写的是确切版本（如 molstar 5.11.0），不能让包管理器存成 ^ 范围
    peers = [f"{name}@{spec}" for name, spec in package.get("peerDependencies", {}).items()]
    if peers:
        peers.insert(0, "--save-exact")
    if not (root() / "node_modules").is_dir():
        plan.steps.append(Step(["npm", "install"], root(), "MyKit 还没装过 npm 依赖"))
    if package.get("scripts", {}).get("build"):
        plan.steps.append(Step(["npm", "run", "build", "-w", component.npm_name], root(), "构建"))
    if not plan.pinned:
        plan.steps.append(Step([tool, verb, _relative(component.ts_dir, project), *peers], project, "本地路径安装"))
        return
    vendor = project / VENDOR
    tarball = f"mykit-{component.id}-{component.version}.tgz"
    plan.make_dirs.append(vendor)
    plan.steps.append(Step(["npm", "pack", "-w", component.npm_name, "--pack-destination", str(vendor)], root(), "打包 tgz"))
    plan.steps.append(Step([tool, verb, _relative(vendor / tarball, project), *peers], project, "从 tgz 安装"))
    plan.remove_after += _stale(vendor, rf"mykit-{re.escape(component.id)}-\d+\.\d+\.\d+\.tgz", tarball)


def describe(plan: Plan) -> str:
    languages = " + ".join(LANGUAGE_LABELS[lang] for lang in plan.languages)
    how = f"锁定 {plan.component.version}" if plan.pinned else "链接到 MyKit（随源码更新）"
    return f"{plan.component.id} → {languages}，{how}"


def require_tools(plan: Plan) -> None:
    missing = sorted({step.command[0] for step in plan.steps if shutil.which(step.command[0]) is None})
    if missing:
        hint = "（pnpm 可用 corepack enable 启用）" if "pnpm" in missing else ""
        raise KitError(f"找不到命令：{', '.join(missing)}{hint}")


# ---- 项目里已经装了什么 ----

_WHEEL = re.compile(r"mykit_[a-z0-9_]+-(\d+\.\d+\.\d+)-py3-none-any\.whl$")
_TARBALL = re.compile(r"mykit-[a-z0-9-]+?-(\d+\.\d+\.\d+)\.tgz$")
_TAG = re.compile(r"-v(\d+\.\d+\.\d+)$")


@dataclass
class Usage:
    component_id: str
    language: str
    mode: str  # link：随 MyKit 源码更新；pin：锁定版本；other：认不出来的装法
    version: str | None
    detail: str


def find_usages(project: Path) -> list[Usage]:
    usages: list[Usage] = []
    pyproject = project / "pyproject.toml"
    if pyproject.exists():
        sources = load_toml(pyproject).get("tool", {}).get("uv", {}).get("sources", {})
        for name, source in sorted(sources.items()):
            if name.startswith("mykit-") and isinstance(source, dict):
                usages.append(_python_usage(name.removeprefix("mykit-"), source))
    manifest = project / "package.json"
    if manifest.exists():
        package = json.loads(manifest.read_text(encoding="utf-8"))
        specs = {**package.get("devDependencies", {}), **package.get("dependencies", {})}
        for name, spec in sorted(specs.items()):
            if name.startswith("@mykit/"):
                usages.append(_ts_usage(name.removeprefix("@mykit/"), str(spec)))
    return usages


def _python_usage(cid: str, source: dict) -> Usage:
    if "path" in source:
        path = str(source["path"])
        wheel = _WHEEL.search(path)
        if wheel:
            return Usage(cid, "python", "pin", wheel.group(1), path)
        if source.get("editable"):
            return Usage(cid, "python", "link", None, path)
        return Usage(cid, "python", "other", None, f"{path}（非可编辑的本地路径，不会随源码更新）")
    if "git" in source:
        rev = str(source.get("tag") or source.get("rev") or "")
        tag = _TAG.search(rev)
        if tag:
            return Usage(cid, "python", "pin", tag.group(1), f"git {rev}")
        return Usage(cid, "python", "other", None, f"git {rev or source['git']}")
    return Usage(cid, "python", "other", None, str(source))


def _ts_usage(cid: str, spec: str) -> Usage:
    tarball = _TARBALL.search(spec)
    if tarball:
        return Usage(cid, "typescript", "pin", tarball.group(1), spec)
    if spec.startswith(("file:", "link:")):
        return Usage(cid, "typescript", "link", None, spec)
    return Usage(cid, "typescript", "other", None, spec)


def needs_build(component: Component) -> bool:
    """TS 组件的 dist/ 比 src/ 旧（或还没构建）时为 True；没有 build 脚本的组件总是 False。"""
    if "typescript" not in component.languages or not component.package_json().get("scripts", {}).get("build"):
        return False
    built = [path.stat().st_mtime for path in (component.ts_dir / "dist").rglob("*") if path.is_file()]
    if not built:
        return True
    sources = [path.stat().st_mtime for path in (component.ts_dir / "src").rglob("*") if path.is_file()]
    return bool(sources) and max(sources) > min(built)
