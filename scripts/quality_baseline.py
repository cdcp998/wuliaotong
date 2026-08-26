"""后端代码质量基线（零依赖 stdlib）：圈复杂度 / 循环依赖 / 模块不稳定度 / 死符号候选。

用法：
    backend/.venv/Scripts/python.exe scripts/quality_baseline.py [--json out.json]

口径说明（自洽可复现；与 radon 等外部工具可能有细微差异）：
- 圈复杂度：McCabe 口径。每个函数/方法基础 1，if/for/while/except/assert/IfExp 各 +1，
  BoolOp 按 (取值数-1) 加权，推导式每个 for/if 各 +1，match 每个 case +1。
- 循环依赖：以 app 包内模块为节点、import 语句为边，Tarjan 强连通分量，size>1 即环。
- 不稳定度（Martin I）：I = 扇出 / (扇入+扇出)，仅统计 app 包内边。
  I 高且扇出高 = 依赖别人多的「易变候选」；扇入高的枢纽模块改动需谨慎。
- 死符号候选：模块顶层 def/class 名在全库源码中无任何外部引用、定义文件内也仅出现一次。
  带装饰器的符号一律排除（FastAPI 路由等由框架注册），结果需人工确认后再删。
"""
from __future__ import annotations

import argparse
import ast
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PKG_DIR = ROOT / "backend" / "app"


def iter_py() -> list[Path]:
    return [p for p in PKG_DIR.rglob("*.py") if "__pycache__" not in p.parts]


def path_to_module(p: Path) -> str:
    rel = p.relative_to(PKG_DIR.parent).with_suffix("")
    parts = list(rel.parts)
    if parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts)


def cyclomatic_complexity(node: ast.AST) -> int:
    score = 1
    for child in ast.walk(node):
        if isinstance(child, (ast.If, ast.For, ast.AsyncFor, ast.While, ast.ExceptHandler, ast.Assert, ast.IfExp)):
            score += 1
        elif isinstance(child, ast.BoolOp):
            score += len(child.values) - 1
        elif isinstance(child, ast.comprehension):
            score += 1 + len(child.ifs)
        elif hasattr(ast, "match_case") and isinstance(child, ast.match_case):
            score += 1
    return score


def collect_functions(tree: ast.Module) -> list[tuple[str, int]]:
    out: list[tuple[str, int]] = []

    class Visitor(ast.NodeVisitor):
        def __init__(self) -> None:
            self.stack: list[str] = []

        def _fn(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
            name = ".".join([*self.stack, node.name])
            out.append((name, cyclomatic_complexity(node)))
            self.stack.append(node.name)
            self.generic_visit(node)
            self.stack.pop()

        visit_FunctionDef = _fn
        visit_AsyncFunctionDef = _fn

        def visit_ClassDef(self, node: ast.ClassDef) -> None:
            self.stack.append(node.name)
            self.generic_visit(node)
            self.stack.pop()

    Visitor().visit(tree)
    return out


def module_imports(tree: ast.Module, my_module: str) -> set[str]:
    targets: set[str] = set()
    pkg_of_me = my_module.rsplit(".", 1)[0] if "." in my_module else ""
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == "app" or alias.name.startswith("app."):
                    targets.add(alias.name)
        elif isinstance(node, ast.ImportFrom):
            if node.level == 0 and node.module and (node.module == "app" or node.module.startswith("app.")):
                targets.add(node.module)
            elif node.level > 0:  # 相对导入
                base_parts = pkg_of_me.split(".")
                for _ in range(node.level - 1):
                    base_parts = base_parts[:-1]
                target_base = ".".join(base_parts)
                full = f"{target_base}.{node.module}" if node.module else target_base
                targets.add(full)
    return targets


def edge_endpoint(target: str, known: set[str]) -> str | None:
    while target:
        if target in known:
            return target
        target = target.rsplit(".", 1)[0] if "." in target else ""
    return None


def tarjan_scc(graph: dict[str, set[str]]) -> list[list[str]]:
    index_counter = [0]
    stack: list[str] = []
    lowlink: dict[str, int] = {}
    index: dict[str, int] = {}
    on_stack: dict[str, bool] = {}
    result: list[list[str]] = []

    def strongconnect(v: str) -> None:
        index[v] = index_counter[0]
        lowlink[v] = index_counter[0]
        index_counter[0] += 1
        stack.append(v)
        on_stack[v] = True
        for w in sorted(graph.get(v, ())):
            if w not in index:
                strongconnect(w)
                lowlink[v] = min(lowlink[v], lowlink[w])
            elif on_stack.get(w):
                lowlink[v] = min(lowlink[v], index[w])
        if lowlink[v] == index[v]:
            comp: list[str] = []
            while True:
                w = stack.pop()
                on_stack[w] = False
                comp.append(w)
                if w == v:
                    break
            result.append(comp)

    for v in sorted(graph):
        if v not in index:
            strongconnect(v)
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", dest="json_out", default=None, help="同时输出机器可读 JSON 到该路径")
    args = parser.parse_args()

    files = iter_py()
    sources: dict[Path, str] = {p: p.read_text(encoding="utf-8", errors="replace") for p in files}
    trees: dict[Path, ast.Module] = {p: ast.parse(src) for p, src in sources.items()}
    known_modules = {path_to_module(p) for p in files}

    # ---- 圈复杂度 ----
    fn_cc: list[tuple[str, str, int]] = []
    for p, tree in trees.items():
        mod = path_to_module(p)
        for name, cc in collect_functions(tree):
            fn_cc.append((mod, name, cc))
    fn_cc.sort(key=lambda x: -x[2])
    total = sum(cc for _, _, cc in fn_cc)
    avg = total / len(fn_cc) if fn_cc else 0.0
    over10 = [(m, n, c) for m, n, c in fn_cc if c > 10]

    print(f"== 圈复杂度 ==")
    print(f"函数总数 {len(fn_cc)}，平均 CC {avg:.2f}，CC>10 的函数 {len(over10)} 个")
    print("Top 10 最复杂函数：")
    for m, n, c in fn_cc[:10]:
        print(f"  CC {c:>4}  {m}::{n}")

    # ---- 依赖图：环 / 不稳定度 ----
    graph: dict[str, set[str]] = defaultdict(set)
    for p, tree in trees.items():
        src_mod = path_to_module(p)
        for t in module_imports(tree, src_mod):
            ep = edge_endpoint(t, known_modules)
            if ep and ep != src_mod:
                graph[src_mod].add(ep)

    fan_in: dict[str, int] = defaultdict(int)
    fan_out: dict[str, int] = defaultdict(int)
    for src, dsts in graph.items():
        fan_out[src] += len(dsts)
        for d in dsts:
            fan_in[d] += 1

    sccs = [c for c in tarjan_scc(dict(graph)) if len(c) > 1]
    print(f"\n== 循环依赖 ==")
    print(f"环（强连通分量 >1 节点）：{len(sccs)} 个")
    for comp in sccs:
        print(f"  环: {' <-> '.join(comp)}")

    unstable = []
    for mod in set(list(fan_in) + list(fan_out)):
        fi, fo = fan_in.get(mod, 0), fan_out.get(mod, 0)
        if fi + fo > 0:
            unstable.append((mod, fi, fo, fo / (fi + fo)))
    unstable.sort(key=lambda x: (-x[3], -x[2]))
    volatile = [u for u in unstable if u[3] >= 0.8 and u[2] >= 3]
    hubs = sorted(unstable, key=lambda x: -x[1])[:10]
    print(f"\n== 不稳定度（app 包内 {len(unstable)} 个有向依赖模块）==")
    print(f"I>=0.8 且扇出>=3 的「易变候选」：{len(volatile)} 个")
    for mod, fi, fo, i in volatile[:15]:
        print(f"  I={i:.2f}  扇入{fi:>2} 扇出{fo:>2}  {mod}")
    print("扇入 Top10（枢纽模块，改动需回归其下游）：")
    for mod, fi, fo, i in hubs:
        print(f"  扇入{fi:>2}  {mod}")

    # ---- 死符号候选 ----
    all_text = "\n".join(sources.values())
    decorated: set[str] = set()
    top_defs: dict[str, tuple[str, int]] = {}
    for p, tree in trees.items():
        mod = path_to_module(p)
        for node in tree.body:
            names: list[str] = []
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                names = [node.name]
                if node.decorator_list:
                    decorated.update(names)
            elif isinstance(node, ast.Assign):
                names = [t.id for t in node.targets if isinstance(t, ast.Name)]
            for n in names:
                if n.startswith("__") or n in top_defs:
                    continue
                top_defs[n] = (mod, sum(1 for m in all_text.split(n)[:-1]) and 0 or 0)
    dead_candidates: list[tuple[str, str]] = []
    exported = set()
    for p, src in sources.items():
        for node in ast.walk(trees[p]):
            if isinstance(node, ast.Assign):
                for t in node.targets:
                    if isinstance(t, ast.Name) and t.id == "__all__":
                        try:
                            exported.update(el.value for el in node.value.elts if isinstance(el, ast.Constant))  # type: ignore[attr-defined]
                        except Exception:
                            pass
    for name, (mod, _) in top_defs.items():
        if name in decorated or name in exported or name.startswith("_"):
            continue
        occurrences = all_text.count(name)
        if occurrences <= 1:  # 全库只出现一次 = 仅定义处
            dead_candidates.append((mod, name))
    print(f"\n== 死符号候选（需人工确认，已排除装饰器注册/__all__/下划线私有）==")
    print(f"候选 {len(dead_candidates)} 个：")
    for mod, name in dead_candidates[:40]:
        print(f"  {mod}::{name}")
    if len(dead_candidates) > 40:
        print(f"  ...其余 {len(dead_candidates) - 40} 个见 JSON")

    if args.json_out:
        payload = {
            "cc": {"function_count": len(fn_cc), "average": round(avg, 2), "over_10": len(over10), "top20": [{"module": m, "name": n, "cc": c} for m, n, c in fn_cc[:20]]},
            "cycles": [{"modules": c} for c in sccs],
            "instability": {"volatile_candidates": [{"module": m, "fan_in": fi, "fan_out": fo, "i": round(i, 2)} for m, fi, fo, i in volatile], "hub_top10": [{"module": m, "fan_in": fi} for m, fi, _, _ in hubs]},
            "dead_symbol_candidates": [{"module": m, "name": n} for m, n in dead_candidates],
        }
        Path(args.json_out).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nJSON 已写入 {args.json_out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
