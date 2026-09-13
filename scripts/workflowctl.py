#!/usr/bin/env python3
"""Check progressive planning contracts and candidate-bound result identities."""

from __future__ import annotations

import argparse
import json
import re
import sys
import os
from pathlib import Path, PurePosixPath

# Workflow supplies the selected profile for role validation; model choices are not frozen into the plan.
def load_role_profiles(_root):
    return json.loads(os.environ["DSH_ROLE_PROFILES"]), None


ProfileError = ValueError


TASK = re.compile(r"T[0-9]+")
GENERATION = re.compile(r"generation-[1-9][0-9]*")


class Invalid(ValueError):
    pass


def read(path: Path) -> tuple[dict[str, str], dict[str, dict[str, str]], str]:
    text = path.read_text(encoding="utf-8")
    top: dict[str, str] = {}
    sections: dict[str, dict[str, str]] = {}
    current = top
    fence = ""
    for line in text.splitlines():
        marker = re.match(r"^\s*(`{3,}|~{3,})", line)
        if marker:
            token = marker.group(1)
            if not fence:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence):
                fence = ""
            continue
        if fence:
            continue
        if line.startswith("## "):
            name = line[3:].strip()
            if name in sections:
                raise Invalid(f"{path}: duplicate section {name}")
            current = sections.setdefault(name, {})
        match = re.fullmatch(r"- ([^:]+):\s*(.*)", line)
        if match:
            key, value = match.groups()
            if key in current:
                raise Invalid(f"{path}: duplicate field {key}")
            value = value.strip()
            # Inline-code markup does not change a machine field's identity.
            if len(value) > 2 and value.startswith('`') and value.endswith('`') and '`' not in value[1:-1]:
                value = value[1:-1]
            current[key] = value
    return top, sections, text


def required(fields: dict[str, str], keys: tuple[str, ...], source: Path) -> None:
    for key in keys:
        if not fields.get(key):
            raise Invalid(f"{source}: missing {key}")


def positive(value: str, source: Path) -> int:
    if not re.fullmatch(r"[1-9][0-9]*", value):
        raise Invalid(f"{source}: expected positive revision/attempt, got {value!r}")
    return int(value)


def array(fields: dict[str, str], key: str, source: Path) -> list[str]:
    try:
        values = json.loads(fields[key])
    except (KeyError, json.JSONDecodeError) as error:
        raise Invalid(f"{source}: {key} requires a JSON array") from error
    if not isinstance(values, list) or any(
        not isinstance(value, str) or not value.strip() for value in values
    ):
        raise Invalid(f"{source}: {key} requires nonempty strings")
    if len(values) != len(set(values)):
        raise Invalid(f"{source}: duplicate {key} entries")
    return values


def scope(value: str) -> str:
    path = PurePosixPath(value)
    if (path.is_absolute() or not path.parts or ".." in path.parts
            or any(char in value for char in "*?[]\\") or value != value.strip()):
        raise Invalid(f"unsafe or non-exact owned path: {value!r}")
    return path.as_posix()


def within(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise Invalid(f"artifact escapes generation: {relative}")
    return path


def contract(path: Path, roles: set[str]) -> dict[str, str]:
    fields, sections, text = read(path)
    required(fields, ("Revision", "Kind", "Role", "Depends on", "Owned paths",
                      "Resources", "Inputs", "Review"), path)
    positive(fields["Revision"], path)
    if fields["Kind"] not in {"investigation", "implementation", "validation"}:
        raise Invalid(f"{path}: invalid Kind")
    if fields["Role"] not in roles:
        raise Invalid(f"{path}: invalid execution Role")
    if fields["Kind"] == "implementation" and fields["Role"] not in {
        "def_coding_worker", "sup_coding_worker"
    }:
        raise Invalid(f"{path}: implementation requires a coding worker")
    if fields["Review"] not in {"dispatcher", "independent"}:
        raise Invalid(f"{path}: invalid Review")
    for key in ("Depends on", "Owned paths", "Resources", "Inputs"):
        values = array(fields, key, path)
        if key == "Inputs" and not values:
            raise Invalid(f"{path}: Inputs must bind evidence")
        if key == "Owned paths":
            normalized = [scope(value) for value in values]
            if len(normalized) != len(set(normalized)):
                raise Invalid(f"{path}: duplicate normalized ownership")
            if values and fields["Role"] in {"context_collector", "evidence_runner", "full_tester"}:
                raise Invalid(f"{path}: read-only role cannot own product writes")
    if fields.get("Lane", "yes") not in {"yes", "no"}:
        raise Invalid(f"{path}: Lane must be yes or no")
    if fields.get("Lane") == "no" and not fields.get("Cwd"):
        raise Invalid(f"{path}: no-lane task requires Cwd")
    if fields.get("Network", "disabled") not in {"disabled", "loopback"}:
        raise Invalid(f"{path}: Network must be disabled or loopback")
    if "Cwd" in fields and fields["Cwd"] != ".":
        scope(fields["Cwd"])
    for key in ("Read paths", "Write paths", "Reports", "Ports"):
        if key in fields:
            for value in array(fields, key, path):
                if value != ".": scope(value)
    if fields.get("Lane") == "no" and "Read paths" not in fields:
        raise Invalid(f"{path}: no-lane task requires explicit Read paths")
    for heading in ("Goal", "Acceptance", "Constraints", "Validation", "Return when"):
        if heading not in sections:
            raise Invalid(f"{path}: missing {heading} section")
        body = re.split(r"(?m)^## ", re.split(
            rf"(?m)^## {re.escape(heading)}\s*\n", text, maxsplit=1
        )[-1], maxsplit=1)[0]
        if not body.strip():
            raise Invalid(f"{path}: empty {heading} section")
    return fields


def validate(generation: Path) -> None:
    if not GENERATION.fullmatch(generation.name):
        raise Invalid("expected a generation-N directory; legacy layouts need explicit migration")
    plan_path = within(generation, "plan.md")
    plan, sections, _ = read(plan_path)
    required(plan, ("Schema", "Revision", "Repository", "Target", "Base", "Delivery"), plan_path)
    if plan["Schema"] != "1" or plan["Delivery"] not in {"working-tree", "target-merge"}:
        raise Invalid(f"{plan_path}: unsupported Schema or Delivery")
    positive(plan["Revision"], plan_path)
    if not Path(plan["Repository"]).is_absolute():
        raise Invalid(f"{plan_path}: Repository must be absolute")
    if not {"Goal", "Acceptance"} <= sections.keys():
        raise Invalid(f"{plan_path}: Goal and Acceptance required")
    index_path = within(generation, "tasks.md")
    _, index, _ = read(index_path)
    roles, _ = load_role_profiles(Path(__file__).resolve().parents[1])
    entries = {key: value for key, value in index.items() if TASK.fullmatch(key)}
    if not entries:
        raise Invalid(f"{index_path}: no indexed tasks")
    contracts: dict[str, dict[str, str]] = {}
    dependencies: dict[str, set[str]] = {}
    for task, entry in entries.items():
        required(entry, ("State", "Revision"), index_path)
        positive(entry["Revision"], index_path)
        if entry["State"] not in {"draft", "executable", "retired"}:
            raise Invalid(f"{task}: invalid planning State")
        dependencies[task] = set()
        if entry["State"] != "executable":
            continue
        path = within(generation, f"tasks/{task}.md")
        fields = contract(path, set(roles))
        if fields["Revision"] != entry["Revision"]:
            raise Invalid(f"{task}: contract/index revision mismatch")
        contracts[task] = fields
        deps = set(array(fields, "Depends on", path))
        if not deps <= entries.keys():
            raise Invalid(f"{task}: unknown dependency")
        if any(entries[dep]["State"] == "retired" for dep in deps):
            raise Invalid(f"{task}: dependency is retired; map its accepted replacement")
        dependencies[task] = deps

    ancestors: dict[str, set[str]] = {}

    def visit(task: str, active: set[str]) -> set[str]:
        if task in active:
            raise Invalid(f"dependency cycle at {task}")
        if task not in ancestors:
            ancestors[task] = set(dependencies[task])
            for dep in dependencies[task]:
                ancestors[task].update(visit(dep, active | {task}))
        return ancestors[task]

    for task in entries:
        visit(task, set())
    for left, a in contracts.items():
        for right, b in contracts.items():
            if left >= right or left in ancestors[right] or right in ancestors[left]:
                continue
            if set(json.loads(a["Resources"])) & set(json.loads(b["Resources"])):
                continue
            for p in map(scope, json.loads(a["Owned paths"])):
                for q in map(scope, json.loads(b["Owned paths"])):
                    if p == q or p.startswith(q + "/") or q.startswith(p + "/"):
                        raise Invalid(f"{left}/{right}: concurrent ownership overlap at {p}/{q}")


def result_check(result: Path, contract_path: Path, review: Path | None) -> None:
    roles, _ = load_role_profiles(Path(__file__).resolve().parents[1])
    assigned = contract(contract_path, set(roles))
    fields, _, _ = read(result)
    required(fields, ("Task", "Contract revision", "Attempt", "Input snapshot",
                      "Candidate snapshot", "Outcome"), result)
    task = contract_path.parent.name.split("-A")[0] if contract_path.name == "contract.md" else contract_path.stem
    if not TASK.fullmatch(fields["Task"]) or fields["Task"] != task:
        raise Invalid("result task does not match retained contract identity")
    if fields["Contract revision"] != assigned["Revision"]:
        raise Invalid("result contract revision mismatch")
    positive(fields["Attempt"], result)
    if result.name != f"{fields['Task']}-A{fields['Attempt']}.md" and not (result.name == "result.md" and result.parent.name == f"{fields['Task']}-A{fields['Attempt']}"):
        raise Invalid("result filename does not match Task/Attempt")
    if fields["Outcome"] not in {"complete", "blocked", "needs-decision", "needs-verification"}:
        raise Invalid("invalid result Outcome")
    if review is not None:
        checked, _, _ = read(review)
        required(checked, ("Task", "Contract revision", "Result", "Candidate snapshot", "Verdict"), review)
        if any(checked[key] != fields[key] for key in ("Task", "Contract revision", "Candidate snapshot")):
            raise Invalid("review does not bind the result candidate/contract")
        if checked["Result"] != result.name:
            raise Invalid("review references a different result")
        if checked["Verdict"] not in {"passed", "changes-required", "needs-decision"}:
            raise Invalid("invalid review Verdict")
    # Identity validity is not acceptance; dispatcher checks actual outcomes,
    # reviewer independence, required review presence and delivery separately.


def export_dsh(generation: Path) -> dict:
    """Resolve the existing contract format once for the DSH execution service."""
    generation = generation.resolve()
    validate(generation)
    plan, sections, text = read(within(generation, "plan.md"))
    roles, _ = load_role_profiles(Path(__file__).resolve().parents[1])
    _, index, _ = read(within(generation, "tasks.md"))
    tasks = {}
    for task, entry in index.items():
        if not TASK.fullmatch(task) or entry.get("State") != "executable":
            continue
        path = within(generation, f"tasks/{task}.md")
        fields = contract(path, set(roles))
        tasks[task] = {"id": task, "revision": int(fields["Revision"]), "role": fields["Role"],
                       "depends": array(fields, "Depends on", path), "owned": array(fields, "Owned paths", path),
                       "resources": array(fields, "Resources", path), "inputs": array(fields, "Inputs", path),
                       "review": fields["Review"], "text": path.read_text(),
                       "network": fields.get("Network", "disabled"), "lane": fields.get("Lane", "yes") == "yes", "cwd": fields.get("Cwd", "."),
                       "reads": array(fields, "Read paths", path) if "Read paths" in fields else ["."],
                       "writes": array(fields, "Write paths", path) if "Write paths" in fields else [],
                       "reports": array(fields, "Reports", path) if "Reports" in fields else [],
                       "ports": array(fields, "Ports", path) if "Ports" in fields else []}
    lane = sections.get("Lane policy", {})
    if not lane and not any(task["lane"] for task in tasks.values()):
        lane = {"Initial lanes":"0", "Max lanes":"0", "Expand":"no", "Bases":'["plan", "accepted-dependency", "target"]', "Isolation":"worktree", "Merge method":"merge"}
    required(lane, ("Initial lanes", "Max lanes", "Expand", "Bases", "Isolation", "Merge method"), generation)
    if any(not re.fullmatch(r"0|[1-9][0-9]*", lane[key]) for key in ("Initial lanes", "Max lanes")):
        raise Invalid("lane capacities must be nonnegative integers")
    initial = int(lane["Initial lanes"])
    maximum = int(lane["Max lanes"])
    if initial > maximum or lane["Expand"] not in {"yes", "no"}:
        raise Invalid("invalid lane capacity/expansion policy")
    if lane["Isolation"] != "worktree" or lane["Merge method"] != "merge":
        raise Invalid("DSH currently executes worktree isolation and merge integration; amend explicitly for another strategy")
    bases = array(lane, "Bases", generation)
    if not bases or any(base not in {"plan", "accepted-dependency", "target"} for base in bases):
        raise Invalid("Bases must select plan, accepted-dependency, or target")
    return {"generation": str(generation), "revision": int(plan["Revision"]), "repository": plan["Repository"],
            "target": plan["Target"], "base": plan["Base"], "delivery": plan["Delivery"], "text": text,
            "policy": {"initial": initial, "max": maximum, "expand": lane["Expand"] == "yes", "bases": bases},
            "concurrency": positive(plan.get("Max workers", "4"), generation), "tasks": tasks}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    check = commands.add_parser("validate")
    check.add_argument("generation", type=Path)
    export = commands.add_parser("export-dsh")
    export.add_argument("generation", type=Path)
    result = commands.add_parser("result-check")
    result.add_argument("result", type=Path)
    result.add_argument("--contract", type=Path, required=True)
    result.add_argument("--review", type=Path)
    result.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.command == "export-dsh":
            print(json.dumps(export_dsh(args.generation)))
            return 0
        if args.command == "validate":
            validate(args.generation)
        else:
            result_check(args.result, args.contract, args.review)
            if args.json:
                print(json.dumps(read(args.result)[0]))
                return 0
    except (Invalid, ProfileError, OSError, ValueError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print("Structure/identity valid; acceptance still requires execution evidence.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
