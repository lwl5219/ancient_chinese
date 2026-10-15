"""Explicit, hash-checked review of changes to source text or annotations.

Published JSON contains later editorial work that cannot safely be regenerated
from the original volume-one pipeline. Never guess how to merge that work.
"""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path


def digest(value) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                    separators=(",", ":")).encode()).hexdigest()


def file_digest(path: Path) -> str | None:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def fingerprints(source: list[dict], notes: dict) -> dict:
    result = {}
    for src in source:
        aid = src["id"]
        if aid in result:
            raise SystemExit(f"重复篇目 ID：{aid}")
        result[aid] = {"source": digest(src), "annotations": digest(notes.get(aid))}
    return result


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def summarize(plan_path: Path, out: Path) -> None:
    """Print review values; deliberately do not approve or modify the plan."""
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    summary = {}
    for aid, update in plan["updates"].items():
        path = (plan_path.parent / update["reviewed_file"]).resolve()
        if not path.is_relative_to(plan_path.parent.resolve()):
            raise SystemExit("审阅文件必须在计划目录内")
        article = json.loads(path.read_text(encoding="utf-8"))
        published = out / "articles" / f"{aid}.json"
        old = json.loads(published.read_text(encoding="utf-8")) if published.exists() else {}
        summary[aid] = {"reviewed_sha256": file_digest(path), "approved_field_changes": {
            key: {"before": digest(value), "after": digest(article.get(key))}
            for key, value in old.items() if key not in article or article[key] != value
        }}
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def prepare(source, notes, manifest_path, out, candidate, plan_dir=None, apply_plan=None):
    if not manifest_path.is_file():
        raise SystemExit("缺少 data/build-inputs.json 输入基线；请从同一版本恢复，不能静默建立新基线。")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema") != 1:
        raise SystemExit("不支持的构建输入基线版本")
    current = fingerprints(source, notes)
    previous = manifest["articles"]
    changed = sorted(aid for aid in previous.keys() | current.keys()
                     if previous.get(aid) != current.get(aid))
    removed = [aid for aid in changed if aid not in current]
    if removed:
        raise SystemExit("输入删除了已有篇目，需人工调整目录及输入基线：" + ", ".join(removed))
    if plan_dir:
        if plan_dir.exists():
            raise SystemExit(f"审阅目录已存在，拒绝覆盖：{plan_dir}")
        # Generate everything before writing the review directory.
        proposed = {src["id"]: candidate(copy.deepcopy(src)) for src in source if src["id"] in changed}
        plan = {"schema": 1, "manifest_sha256": file_digest(manifest_path),
                "inputs": current, "review_note": "", "updates": {}}
        plan_dir.mkdir(parents=True)
        for aid in changed:
            published_path = out / "articles" / f"{aid}.json"
            old = json.loads(published_path.read_text()) if published_path.exists() else None
            write_json(plan_dir / f"{aid}.generated.json", proposed[aid])
            write_json(plan_dir / f"{aid}.published.json", old)
            # Start from the reviewed publication, not the lossy generated draft.
            write_json(plan_dir / f"{aid}.reviewed.json", old if old is not None else proposed[aid])
            plan["updates"][aid] = {
                "published_sha256": file_digest(published_path),
                "reviewed_file": f"{aid}.reviewed.json", "reviewed_sha256": None,
                "approved_field_changes": {},
            }
        write_json(plan_dir / "plan.json", plan)
        print(f"需审阅 {len(changed)} 篇：{plan_dir / 'plan.json'}；未修改发布数据。")
        return {}, manifest
    if not changed and not apply_plan:
        return {}, manifest
    if not apply_plan:
        raise SystemExit("检测到原文/annotations 变更，未写入数据：" + ", ".join(changed)
                         + "。先运行 --plan-update <新目录>，审阅后 --apply-update <目录/plan.json>。")
    plan = json.loads(apply_plan.read_text(encoding="utf-8"))
    if (plan.get("schema") != 1 or plan.get("manifest_sha256") != file_digest(manifest_path)
            or plan.get("inputs") != current or set(plan.get("updates", {})) != set(changed)):
        raise SystemExit("审阅计划已过期或输入不匹配；未写入数据，请重新生成计划。")
    if not isinstance(plan.get("review_note"), str) or not plan["review_note"].strip():
        raise SystemExit("请在计划 review_note 中记录本次人工审阅结论。")
    replacements = {}
    for aid in changed:
        update = plan["updates"][aid]
        published_path = out / "articles" / f"{aid}.json"
        if update["published_sha256"] != file_digest(published_path):
            raise SystemExit(f"已发布篇目在审阅后发生变化：{aid}；未写入数据。")
        reviewed_path = (apply_plan.parent / update["reviewed_file"]).resolve()
        if not reviewed_path.is_relative_to(apply_plan.parent.resolve()):
            raise SystemExit(f"审阅文件必须在计划目录内：{aid}")
        if not update.get("reviewed_sha256") or update["reviewed_sha256"] != file_digest(reviewed_path):
            raise SystemExit(f"请核对并填写 reviewed_sha256：{aid}")
        article = json.loads(reviewed_path.read_text(encoding="utf-8"))
        if article.get("id") != aid or not article.get("paragraphs"):
            raise SystemExit(f"审阅篇目 ID/正文无效：{aid}")
        if published_path.exists():
            old = json.loads(published_path.read_text(encoding="utf-8"))
            # Every changed existing top-level field requires an explicit pair
            # of before/after digests. This includes paragraphs, lessons and
            # custom editorial metadata, so none can disappear accidentally.
            actual_changes = {
                key: {"before": digest(value), "after": digest(article.get(key))}
                for key, value in old.items() if key not in article or article[key] != value
            }
            if update.get("approved_field_changes") != actual_changes:
                raise SystemExit(f"存在未批准的字段变更/译注冲突：{aid}；需逐字段核对 approved_field_changes："
                                 + json.dumps(actual_changes, ensure_ascii=False, sort_keys=True))
        elif update.get("approved_field_changes"):
            raise SystemExit(f"新增篇目不能带有旧字段批准项：{aid}")
        replacements[aid] = article
    updated = copy.deepcopy(manifest)
    updated["articles"] = current
    updated["last_review"] = {"plan_sha256": file_digest(apply_plan), "note": plan["review_note"]}
    return replacements, updated
