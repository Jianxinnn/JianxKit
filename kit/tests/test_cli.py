import json
import shutil
from pathlib import Path

import pytest
from rich.console import Console

from mykit_cli import cli, install
from mykit_cli.checks import run_check
from mykit_cli.registry import KitError, get_component, parse_changelog
from mykit_cli.scaffold import bump_component, new_component

REPO = Path(__file__).resolve().parents[2]


@pytest.fixture
def kit(tmp_path, monkeypatch):
    """MyKit 的副本（不含依赖目录），MYKIT_ROOT 指向它。"""
    copy = tmp_path / "MyKit"
    ignore = shutil.ignore_patterns("node_modules", ".venv", "dist", "demo-build", "__pycache__")
    shutil.copytree(REPO / "components", copy / "components", ignore=ignore)
    shutil.copytree(REPO / "kit" / "templates", copy / "kit" / "templates")
    shutil.copy(REPO / "CATALOG.md", copy / "CATALOG.md")
    monkeypatch.setenv("MYKIT_ROOT", str(copy))
    return copy


@pytest.fixture
def out(monkeypatch, capsys):
    monkeypatch.setattr(cli, "console", Console(width=200, highlight=False))
    return lambda: capsys.readouterr().out


def project(tmp_path, *, pyproject=None, package=None, files=()):
    path = tmp_path / "app"
    path.mkdir()
    if pyproject is not None:
        (path / "pyproject.toml").write_text(pyproject)
    if package is not None:
        (path / "package.json").write_text(json.dumps(package))
    for name in files:
        (path / name).write_text("")
    return path


def test_real_repository_passes_check():
    results, fresh = run_check()
    assert fresh and not any(results.values()), results


def test_new_then_bump_cycle(kit):
    new_component("pdb-io", ["python", "typescript"], "model", "PDB 读写")
    results, fresh = run_check()
    assert fresh
    assert any("README.md 还有" in p for p in results["pdb-io"])
    for name in ("README.md", "CHANGELOG.md"):
        path = kit / "components" / "pdb-io" / name
        path.write_text(path.read_text().replace("（待填写）", "写好了"))
    assert run_check()[0]["pdb-io"] == []
    old, changed = bump_component("pdb-io", "0.2.0")
    assert old == "0.1.0" and len(changed) == 4
    assert get_component("pdb-io").version == "0.2.0"
    assert any("0.2.0 小节还有" in p for p in run_check()[0]["pdb-io"])
    with pytest.raises(KitError, match="已经是"):
        bump_component("pdb-io", "0.2.0")


def test_new_rejects_bad_input(kit):
    with pytest.raises(KitError) as error:
        new_component("Bad_Id", ["rust"], "misc", "")
    assert all(word in str(error.value) for word in ("id", "类别", "语言", "--summary"))


def test_parse_changelog():
    entries = parse_changelog("# 更新记录\n\n## 0.2.0 · 2026-11-02\n\n- 加了 `x`\n  续行\n- 修了 y\n\n## 0.1.0\n\n- 初版\n")
    assert [(e.version, e.date) for e in entries] == [("0.2.0", "2026-11-02"), ("0.1.0", "")]
    assert entries[0].items == ["加了 `x` 续行", "修了 y"]


def test_plan_add_python_link_and_pin(kit, tmp_path):
    app = project(tmp_path, pyproject="[project]\nname='app'\nversion='0'\n")
    link = install.plan_add(get_component("llm-call"), app)
    assert link.steps[-1].command[:3] == ["uv", "add", "--editable"]
    assert link.steps[-1].command[3].endswith("components/llm-call/python")
    vendor = app / "vendor" / "mykit"
    vendor.mkdir(parents=True)
    (vendor / "mykit_llm_call-0.0.9-py3-none-any.whl").write_text("")
    pin = install.plan_add(get_component("llm-call"), app, pin=True)
    assert pin.steps[0].command[:3] == ["uv", "build", "--package"] and pin.steps[0].cwd == kit
    assert pin.steps[1].command == ["uv", "add", "./vendor/mykit/mykit_llm_call-0.1.0-py3-none-any.whl"]
    assert vendor / "mykit_llm_call-0.0.9-py3-none-any.whl" in pin.remove_after
    assert vendor / ".gitignore" in pin.remove_after


def test_link_path_is_relative_only_for_neighbours(kit, tmp_path):
    near = kit.parent / "near-app"
    near.mkdir()
    (near / "pyproject.toml").write_text("[project]\nname='app'\nversion='0'\n")
    assert install.plan_add(get_component("llm-call"), near).steps[-1].command[3] == "../MyKit/components/llm-call/python"
    assert install._relative(Path("/usr/local/lib"), Path("/opt/app")) == "/usr/local/lib"


def test_plan_add_typescript_pnpm_pin_with_peers(kit, tmp_path):
    app = project(tmp_path, package={"name": "app"}, files=["pnpm-lock.yaml"])
    plan = install.plan_add(get_component("molstar-viewer"), app, pin=True)
    assert plan.steps[-1].command == ["pnpm", "add", "./vendor/mykit/mykit-molstar-viewer-0.1.0.tgz", "--save-exact", "molstar@5.11.0"]
    assert ["npm", "pack", "-w", "@mykit/molstar-viewer", "--pack-destination", str(app / "vendor" / "mykit")] in [s.command for s in plan.steps]


def test_plan_add_language_errors(kit, tmp_path):
    both = project(tmp_path, pyproject="[project]\nname='app'\nversion='0'\n", package={"name": "app"})
    with pytest.raises(KitError, match="--lang"):
        install.plan_add(get_component("jev"), both)
    assert install.plan_add(get_component("jev"), both, lang="typescript").languages == ["typescript"]
    with pytest.raises(KitError, match="没有 typescript 实现"):
        install.plan_add(get_component("llm-call"), both, lang="typescript")
    with pytest.raises(KitError, match="不要在 MyKit 仓库里"):
        install.plan_add(get_component("llm-call"), kit / "components" / "jev" / "python")


def test_pin_refuses_component_that_fails_check(kit, tmp_path):
    readme = kit / "components" / "llm-call" / "README.md"
    readme.write_text(readme.read_text() + "\n（待填写）\n")
    app = project(tmp_path, pyproject="[project]\nname='app'\nversion='0'\n")
    with pytest.raises(KitError, match="没通过 mykit check"):
        install.plan_add(get_component("llm-call"), app, pin=True)


def test_find_usages_and_outdated(kit, tmp_path, out):
    bump_component("react-loop", "0.2.0")
    changelog = kit / "components" / "react-loop" / "CHANGELOG.md"
    changelog.write_text(changelog.read_text().replace("（待填写）", "新增 `stop_when` 回调", 1))
    pyproject = """[project]\nname = "app"\nversion = "0"\n
[tool.uv.sources]
mykit-react-loop = { path = "vendor/mykit/mykit_react_loop-0.1.0-py3-none-any.whl" }
mykit-llm-call = { path = "../MyKit/components/llm-call/python", editable = true }
mykit-reflection = { git = "https://example.com/MyKit", subdirectory = "components/reflection/python", tag = "reflection-v0.1.0" }
"""
    app = project(tmp_path, pyproject=pyproject, package={"dependencies": {"@mykit/jev": "file:vendor/mykit/mykit-jev-0.1.0.tgz", "zod": "^4"}})
    usages = {(u.component_id, u.mode, u.version) for u in install.find_usages(app)}
    assert usages == {("react-loop", "pin", "0.1.0"), ("llm-call", "link", None), ("reflection", "pin", "0.1.0"), ("jev", "pin", "0.1.0")}
    assert cli.main(["outdated", "--project", str(app)]) == 0
    text = out()
    assert "有新版本" in text and "0.1.0 → 0.2.0" in text and "新增 stop_when 回调" in text
    assert "mykit add react-loop --pin" in text


def test_info_and_list_render(kit, out):
    assert cli.main(["info", "diffusion"]) == 0
    text = out()
    assert "import mykit.diffusion" in text and "Protenix" in text and "mykit add diffusion --pin" in text
    assert cli.main(["list", "--category", "ui"]) == 0
    text = out()
    assert "molstar-viewer" in text and "llm-call" not in text


def test_add_dry_run_does_not_touch_project(kit, tmp_path, out):
    app = project(tmp_path, pyproject="[project]\nname='app'\nversion='0'\n")
    before = (app / "pyproject.toml").read_text()
    assert cli.main(["add", "reflection", "--pin", "--dry-run", "--project", str(app)]) == 0
    assert "uv build" in out()
    assert (app / "pyproject.toml").read_text() == before and not (app / "vendor").exists()
