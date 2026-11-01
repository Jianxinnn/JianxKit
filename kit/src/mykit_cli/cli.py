"""mykit 命令行。"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from rich.console import Console
from rich.markup import escape
from rich.table import Table

from . import install
from .checks import run_check, write_catalog
from .registry import (
    CATEGORIES,
    LANGUAGE_LABELS,
    LANGUAGES,
    STATUSES,
    TODO,
    Component,
    KitError,
    get_component,
    load_components,
    root,
    version_key,
)
from .scaffold import bump_component, new_component

console = Console(highlight=False)
STATUS_STYLE = {"stable": "green", "experimental": "yellow", "deprecated": "red"}


def status_text(status: str) -> str:
    return f"[{STATUS_STYLE.get(status, 'white')}]{STATUSES.get(status, status)}[/]"


def plain(text: str) -> str:
    """转义 rich 标记；CHANGELOG 里的 `代码` 在终端里换成青色。"""
    parts = escape(text).split("`")
    return "".join(f"[cyan]{part}[/]" if index % 2 else part for index, part in enumerate(parts))


def run(command: list[str], cwd: Path) -> int:
    console.print(f"[dim]$ {' '.join(command)}[/]")
    return subprocess.run(command, cwd=cwd).returncode


# ---- 使用组件 ----


def bullets(items: list[str], indent: int = 4) -> Table:
    """列表项换行时和文字对齐，而不是退回行首。"""
    grid = Table.grid(padding=(0, 1))
    grid.add_column(width=indent + 1, justify="right", style="dim")
    grid.add_column(overflow="fold")
    for item in items:
        grid.add_row("•", plain(item))
    return grid


def cmd_list(args: argparse.Namespace) -> int:
    components = [c for c in load_components() if not args.category or c.category == args.category]
    width = max((len(c.id) for c in components), default=0)
    for c in components:
        languages = " · ".join(LANGUAGE_LABELS[lang] for lang in c.languages)
        console.print(f"[bold cyan]{c.id:<{width}}[/]  {c.version}  {status_text(c.status)}  [dim]{CATEGORIES.get(c.category, c.category)} · {languages}[/]")
        line = Table.grid()
        line.add_column(width=width + 2)
        line.add_column(overflow="fold")
        line.add_row("", plain(c.summary))
        console.print(line)
    console.print("\n[dim]详情 mykit info <组件>　安装 mykit add <组件>　文档站 mykit docs[/]")
    return 0


def cmd_info(args: argparse.Namespace) -> int:
    c = get_component(args.id)
    console.print(f"\n[bold cyan]{c.id}[/] [bold]{c.version}[/]  {status_text(c.status)}  [dim]{CATEGORIES.get(c.category, c.category)}[/]")
    console.print(plain(c.summary) + "\n")
    grid = Table.grid(padding=(0, 2))
    grid.add_column(style="dim", no_wrap=True)
    grid.add_column()
    if "python" in c.languages:
        deps = ", ".join(c.python_dependencies()) or "无（只用标准库）"
        grid.add_row("Python", f"{c.python_name}  →  [green]import {c.python_import}[/]  [dim]依赖：{escape(deps)}[/]")
    if "typescript" in c.languages:
        deps = ", ".join(f"{k}@{v}" for k, v in c.ts_dependencies().items()) or "无"
        grid.add_row("TypeScript", f"{c.npm_name}  [dim]依赖：{escape(deps)}[/]")
    for source in c.sources:
        extra = "  ".join(str(source[key]) for key in ("commit", "copied", "license") if source.get(key))
        grid.add_row("来源", f"{escape(str(source.get('project')))} [dim]{escape(extra)}[/]")
    grid.add_row("位置", str(c.path.relative_to(root())))
    console.print(grid)
    console.print("\n[bold]安装[/]（在你的项目根目录运行）")
    console.print(f"  mykit add {c.id}          [dim]开发中：链接到 MyKit，改了立刻生效[/]")
    console.print(f"  mykit add {c.id} --pin    [dim]稳定后：锁定 {c.version}，文件放进 vendor/mykit/[/]")
    entries = c.changelog()[: args.changes]
    if entries:
        console.print("\n[bold]最近更新[/]")
        for entry in entries:
            console.print(f"  [bold]{entry.version}[/] [dim]{entry.date}[/]")
            console.print(bullets(entry.items))
    console.print(f"\n[dim]完整说明：{c.path.relative_to(root())}/README.md，或 mykit docs[/]")
    return 0


def cmd_add(args: argparse.Namespace) -> int:
    project = Path(args.project).resolve()
    plan = install.plan_add(get_component(args.id), project, pin=args.pin, lang=args.lang)
    console.print(f"[bold]{escape(install.describe(plan))}[/]")
    for step in plan.steps:
        where = "MyKit" if step.cwd == root() else "项目"
        console.print(f"  [dim]({where}) {step.note}：[/]{escape(' '.join(step.command))}")
    for path in plan.remove_after:
        if path.name != ".gitignore":
            console.print(f"  [dim]删除旧版本：[/]{escape(str(path.relative_to(project)))}")
    if args.dry_run:
        console.print("[dim]--dry-run：只显示，没有执行[/]")
        return 0
    install.require_tools(plan)
    for directory in plan.make_dirs:
        directory.mkdir(parents=True, exist_ok=True)
    for step in plan.steps:
        code = run(step.command, step.cwd)
        if code:
            console.print(f"[red]失败（退出码 {code}）。[/]项目里的依赖没有改动的话，可以修好后重新运行。")
            return code
    for path in plan.remove_after:
        path.unlink(missing_ok=True)
    console.print(f"\n[green]✓ 已安装 {plan.component.id} {plan.component.version}[/]")
    if "python" in plan.languages:
        console.print(f"  Python：[green]import {plan.component.python_import}[/]")
    if "typescript" in plan.languages:
        console.print(f"  TypeScript：[green]import ... from '{plan.component.npm_name}'[/]")
        if not plan.pinned and plan.component.package_json().get("scripts", {}).get("build"):
            console.print(f"  [dim]改了 {plan.component.id} 的 TS 源码后，在 MyKit 里 npm run build -w {plan.component.npm_name}[/]")
    if plan.pinned:
        console.print("  [dim]记得把 vendor/mykit/ 一起提交；以后 mykit outdated 查看能否升级[/]")
    return 0


def cmd_outdated(args: argparse.Namespace) -> int:
    project = Path(args.project).resolve()
    usages = install.find_usages(project)
    if not usages:
        console.print("这个项目还没装 MyKit 组件。[dim]mykit list 看有哪些，mykit add <组件> 安装。[/]")
        return 0
    known = {c.id: c for c in load_components()}
    table = Table(box=None, pad_edge=False, header_style="bold", show_edge=False)
    for column in ("组件", "语言", "装法", "当前", "MyKit", "状态"):
        table.add_column(column, no_wrap=True)
    upgrades: list[tuple[install.Usage, Component]] = []
    rebuild: list[Component] = []
    for usage in usages:
        component = known.get(usage.component_id)
        latest = component.version if component else "?"
        if component is None:
            state = "[red]MyKit 里没有这个组件[/]"
        elif usage.mode == "pin":
            if version_key(usage.version) < version_key(latest):
                state = "[yellow]有新版本[/]"
                upgrades.append((usage, component))
            elif version_key(usage.version) == version_key(latest):
                state = "[green]最新[/]"
            else:
                state = "[red]比 MyKit 还新？[/]"
        elif usage.mode == "link":
            if usage.language == "typescript" and install.needs_build(component):
                state = "[yellow]源码改过，需要重新构建[/]"
                rebuild.append(component)
            else:
                state = "[green]跟随源码[/]"
        else:
            state = f"[dim]{escape(usage.detail)}[/]"
        mode = {"pin": "锁定", "link": "链接"}.get(usage.mode, "其他")
        table.add_row(f"[bold cyan]{usage.component_id}[/]", LANGUAGE_LABELS[usage.language], mode, usage.version or "-", latest, state)
    console.print(table)
    for usage, component in upgrades:
        console.print(f"\n[bold]{component.id}[/] {usage.version} → {component.version}")
        for entry in component.changelog():
            if version_key(entry.version) <= version_key(usage.version):
                break
            console.print(f"  [bold]{entry.version}[/] [dim]{entry.date}[/]")
            console.print(bullets(entry.items))
        lang = "" if len(component.languages) == 1 else f" --lang {usage.language}"
        console.print(f"  升级：[green]mykit add {component.id} --pin{lang}[/]")
    for component in dict.fromkeys(rebuild):
        console.print(f"\n重新构建 {component.id}：[green]cd {root()} && npm run build -w {component.npm_name}[/]")
    return 0


def cmd_docs(args: argparse.Namespace) -> int:
    if not (root() / "node_modules").is_dir() and run(["npm", "install"], root()):
        return 1
    return run(["npm", "run", "docs:dev", "--", "--open"] if args.open else ["npm", "run", "docs:dev"], root())


def cmd_demo(args: argparse.Namespace) -> int:
    component = get_component(args.id)
    if "typescript" not in component.languages or not component.package_json().get("scripts", {}).get("demo"):
        raise KitError(f"{component.id} 没有本地示例；看文档站 mykit docs")
    if not (root() / "node_modules").is_dir() and run(["npm", "install"], root()):
        return 1
    return run(["npm", "run", "demo", "-w", component.npm_name], root())


# ---- 维护组件库 ----


def cmd_new(args: argparse.Namespace) -> int:
    languages = [lang.strip() for lang in args.lang.split(",") if lang.strip()]
    created = new_component(args.id, languages, args.category, args.summary)
    console.print(f"[green]✓ 已创建 components/{args.id}[/]")
    for path in created:
        console.print(f"  [dim]{path}[/]")
    console.print(f"\n下一步：写代码和测试，把 README.md、CHANGELOG.md 里的 {TODO} 补完，然后 [green]mykit check[/]")
    if "typescript" in languages:
        console.print("TypeScript 组件需要在 MyKit 根目录运行一次 [green]npm install[/]，把它加入工作区。")
    return 0


def cmd_bump(args: argparse.Namespace) -> int:
    old, changed = bump_component(args.id, args.version)
    console.print(f"[green]✓ {args.id}: {old} → {args.version}[/]")
    for path in changed:
        console.print(f"  [dim]{path}[/]")
    console.print(f"\n下一步：在 CHANGELOG.md 写清这次改了什么（替换 {TODO}），[green]mykit check[/] 通过后提交，打 tag：")
    console.print(f"  [green]git tag {args.id}-v{args.version}[/]")
    console.print("锁定了旧版本的项目，运行 [green]mykit outdated[/] 就能看到这次更新。")
    return 0


def cmd_check(_: argparse.Namespace) -> int:
    results, catalog_fresh = run_check()
    for cid, problems in results.items():
        console.print(f"{'[red]✗[/]' if problems else '[green]✓[/]'} {cid}")
        for problem in problems:
            console.print(f"    [red]-[/] {escape(problem)}")
    if not catalog_fresh:
        console.print("[red]✗[/] CATALOG.md 不是最新，运行 [green]mykit catalog[/]")
    failed = not catalog_fresh or any(results.values())
    if not failed:
        console.print(f"\n[green]全部通过[/]（{len(results)} 个组件）")
    return 1 if failed else 0


def cmd_catalog(_: argparse.Namespace) -> int:
    write_catalog()
    console.print("[green]✓ 已更新 CATALOG.md[/]")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mykit",
        description="MyKit 个人组件库",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "使用组件：\n"
            "  mykit list                  有哪些组件\n"
            "  mykit info <组件>           用法、依赖、最近更新\n"
            "  mykit add <组件> [--pin]    装进当前项目\n"
            "  mykit outdated              当前项目的组件能不能升级\n"
            "  mykit docs                  打开文档站\n"
            "\n"
            "维护组件库：\n"
            "  mykit new <组件> --lang python --category ai --summary \"一句话\"\n"
            "  mykit bump <组件> <x.y.z>\n"
            "  mykit check / mykit catalog"
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True, metavar="<命令>")

    p = sub.add_parser("list", help="列出组件")
    p.add_argument("--category", choices=list(CATEGORIES))
    p.set_defaults(func=cmd_list)

    p = sub.add_parser("info", help="组件详情")
    p.add_argument("id")
    p.add_argument("--changes", type=int, default=3, help="显示最近几个版本的更新（默认 3）")
    p.set_defaults(func=cmd_info)

    p = sub.add_parser("add", help="把组件装进当前项目")
    p.add_argument("id")
    p.add_argument("--pin", action="store_true", help="锁定当前版本（打包进 vendor/mykit/），默认链接到 MyKit 源码")
    p.add_argument("--lang", help="python 或 typescript；项目两种都有时需要指定")
    p.add_argument("--project", default=".", help="项目目录，默认当前目录")
    p.add_argument("--dry-run", action="store_true", help="只显示要执行的命令")
    p.set_defaults(func=cmd_add)

    p = sub.add_parser("outdated", help="检查当前项目的组件能否升级")
    p.add_argument("--project", default=".", help="项目目录，默认当前目录")
    p.set_defaults(func=cmd_outdated)

    p = sub.add_parser("docs", help="启动文档站（组件展示、在线示例、更新记录）")
    p.add_argument("--no-open", dest="open", action="store_false", help="不自动打开浏览器")
    p.set_defaults(func=cmd_docs)

    p = sub.add_parser("demo", help="在本地运行组件的示例")
    p.add_argument("id")
    p.set_defaults(func=cmd_demo)

    p = sub.add_parser("new", help="从模板创建组件")
    p.add_argument("id")
    p.add_argument("--lang", required=True, help=f"{'、'.join(LANGUAGES)}，或用逗号连接")
    p.add_argument("--category", required=True, choices=list(CATEGORIES))
    p.add_argument("--summary", required=True, help="一句话说明")
    p.set_defaults(func=cmd_new)

    p = sub.add_parser("bump", help="修改组件版本号")
    p.add_argument("id")
    p.add_argument("version")
    p.set_defaults(func=cmd_bump)

    sub.add_parser("check", help="检查所有组件是否符合规范").set_defaults(func=cmd_check)
    sub.add_parser("catalog", help="重新生成 CATALOG.md").set_defaults(func=cmd_catalog)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except KitError as error:
        console.print(f"[red]{escape(str(error))}[/]")
        return 2
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
