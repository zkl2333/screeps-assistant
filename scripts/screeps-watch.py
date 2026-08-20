#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Screeps 事件监控 — 原生 Hivemind v3 适配版。

只读采集 shard2：
- 官方 API：自有房、RCL、易主、Spawn/Storage、安全模式、核弹、PVP、损失、GCL；
- HM Memory：CPU/Bucket/Creep、外矿列表、扩张目标、HM 进程健康、房间与外矿 Operation。

每次运行保存快照；仅状态发生有意义转折时向 stdout 输出，空输出表示静默。
"""
from __future__ import annotations

import gzip
import json
import math
import os
import re
import statistics
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

CLI_DIR = str(Path(__file__).resolve().parent.parent)
USER_ID = "5dac32ae8cf7c431637c7567"
SHARD = "shard2"
STATE_DIR = "/opt/data/cache/screeps-hm-watch"
STATE_FILE = os.path.join(STATE_DIR, "state.json")
RAW_MEMORY_DIR = "/opt/data/cache/screeps-watch/raw-memory"
RAW_MEMORY_RETENTION_DAYS = 14
ROOM_NAMES_FILE = "/opt/data/cache/screeps-ti-watch/room-names.json"
JOURNAL_DIR = os.path.join(STATE_DIR, "journal")

SQUISHER = "squisher"
SQUISHER_ID = "58a5c0c89f084bf47729f8f2"

LOST_THRESHOLD = 10
PVP_WINDOW_TICKS = 100
DEBOUNCE_CONFIRM = 3
CPU_OVERLOAD_RATIO = 0.95
CPU_RECOVERY_RATIO = 0.90
CPU_CONFIRM = 3
CPU_BUCKET_WARN = 3000
CPU_BUCKET_CRITICAL = 1000
CPU_HISTORY_LIMIT = 144
PROCESS_STALE_TICKS = 50
DOWNGRADE_WARN_TICKS = 25_000
DOWNGRADE_CRITICAL_TICKS = 10_000
STORAGE_ENERGY_DROP_MIN = 25_000
STORAGE_ENERGY_DROP_RATIO = 0.30
ROOM_NAMES: dict[str, str] = {}


class RateLimitedError(RuntimeError):
    """Screeps API 当前读取额度已耗尽。"""


def is_rate_limited(message: Any) -> bool:
    text = str(message).lower()
    return "rate limit exceeded" in text or "status code 429" in text


def run_cli(*args: str, retries: int = 1) -> Any:
    """运行 screeps-api，只允许只读命令。"""
    last_error = "unknown error"
    for attempt in range(retries + 1):
        proc = subprocess.run(
            ["npx", "--no-install", "screeps-api", *args],
            cwd=CLI_DIR,
            capture_output=True,
            text=True,
            timeout=75,
        )
        if proc.returncode == 0 and proc.stdout.strip():
            data = json.loads(proc.stdout)
            while isinstance(data, str):
                data = json.loads(data)
            return data

        last_error = proc.stderr.strip() or proc.stdout.strip() or "empty output"
        if is_rate_limited(last_error):
            raise RateLimitedError("Screeps API read rate limited")
        if attempt < retries:
            time.sleep(1)

    raise RuntimeError(f"CLI failed: {' '.join(args)}: {last_error}")


def memory(path: str) -> Any:
    return run_cli("memory", path, "-s", SHARD)


def api(method: str, *args: str) -> Any:
    return run_cli("call", method, *args)


def load_json(path: str) -> Any:
    try:
        with open(path, encoding="utf-8") as file:
            return json.load(file)
    except (OSError, json.JSONDecodeError):
        return None


def save_json(path: str, value: Any) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temp = path + ".tmp"
    with open(temp, "w", encoding="utf-8") as file:
        json.dump(value, file, ensure_ascii=False, indent=1)
    os.replace(temp, path)


def save_raw_memory_snapshot(snapshot: Any, now: float) -> str:
    """压缩保存完整线上 Memory，并清理超过保留期的快照。"""
    timestamp = time.localtime(now)
    day_dir = os.path.join(RAW_MEMORY_DIR, time.strftime("%Y-%m-%d", timestamp))
    filename = time.strftime("%H-%M-%S", timestamp) + ".json.gz"
    os.makedirs(day_dir, exist_ok=True)
    path = os.path.join(day_dir, filename)
    temp = path + ".tmp"
    with gzip.open(temp, "wt", encoding="utf-8", compresslevel=6) as file:
        json.dump(snapshot, file, ensure_ascii=False, separators=(",", ":"))
    os.replace(temp, path)

    cutoff = now - RAW_MEMORY_RETENTION_DAYS * 24 * 3600
    for day_name in os.listdir(RAW_MEMORY_DIR):
        day_path = os.path.join(RAW_MEMORY_DIR, day_name)
        try:
            day_time = time.mktime(time.strptime(day_name, "%Y-%m-%d"))
        except (TypeError, ValueError):
            continue
        if day_time < cutoff and os.path.isdir(day_path):
            for snapshot_name in os.listdir(day_path):
                os.remove(os.path.join(day_path, snapshot_name))
            os.rmdir(day_path)
    return path


def append_journal(value: dict[str, Any]) -> None:
    beijing = time.gmtime(time.time() + 8 * 3600)
    day = time.strftime("%Y-%m-%d", beijing)
    os.makedirs(JOURNAL_DIR, exist_ok=True)
    with open(os.path.join(JOURNAL_DIR, day + ".jsonl"), "a", encoding="utf-8") as file:
        file.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")


def room_label(room_name: str) -> str:
    alias = ROOM_NAMES.get(room_name)
    return f"{alias}（{room_name}）" if alias else room_name


def gcl_level(gcl: Any) -> int:
    if not isinstance(gcl, (int, float)) or gcl <= 0:
        return 1
    level = 1
    while gcl >= 1_000_000 * (level ** 2.4):
        level += 1
    return level


def history_value(history: Any, key: str, interval: int = 100) -> float | None:
    """按 HM utils/stats.ts 的层级历史格式取最新平均值。"""
    stat = history.get(key) if isinstance(history, dict) else None
    if not isinstance(stat, dict):
        return None

    bucket = stat.get(str(interval)) or stat.get(interval)
    lower = stat.get(str(interval // 10)) or stat.get(interval // 10)
    if isinstance(lower, dict):
        current = [v for v in lower.get("currentValues", []) if isinstance(v, (int, float))]
        previous = [v for v in lower.get("previousValues", []) if isinstance(v, (int, float))]
        values = current + previous[-max(0, 10 - len(current)):]
        if values:
            return sum(values) / len(values)

    if isinstance(bucket, dict):
        current = [v for v in bucket.get("currentValues", []) if isinstance(v, (int, float))]
        if current:
            return current[-1]
    return None


def official_cpu_sample() -> dict[str, Any] | None:
    """读取连续官方 CPU 样本，作为总 CPU 的实时事实源。"""
    try:
        proc = subprocess.run(
            ["node", "sample-cpu.js", "10", "40000"],
            cwd=CLI_DIR,
            capture_output=True,
            text=True,
            timeout=45,
        )
        if proc.returncode != 0 or not proc.stdout.strip():
            return None
        samples = json.loads(proc.stdout)
        valid_samples = [
            sample for sample in samples
            if isinstance(sample, dict) and isinstance(sample.get("cpu"), (int, float))
        ]
        values = [sample["cpu"] for sample in valid_samples]
        if not values:
            return None

        return {
            "samples": valid_samples,
            "sampleCount": len(values),
            "mean": statistics.mean(values),
            "median": statistics.median(values),
            "min": min(values),
            "max": max(values),
            "p95": sorted(values)[max(0, math.ceil(len(values) * 0.95) - 1)],
            "sampledAtStart": valid_samples[0].get("sampledAt"),
            "sampledAtEnd": valid_samples[-1].get("sampledAt"),
        }
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError, TypeError, ValueError):
        return None


def cpu_events(current: dict[str, Any], previous: Any) -> tuple[list[str], dict[str, Any]]:
    previous = previous if isinstance(previous, dict) else {}
    usage = current.get("usage")
    limit = current.get("limit")
    bucket = current.get("bucket")
    if not all(isinstance(value, (int, float)) for value in (usage, limit, bucket)) or limit <= 0:
        return [], previous

    ratio = usage / limit
    events: list[str] = []
    overload_count = previous.get("overload_count", 0) + 1 if ratio >= CPU_OVERLOAD_RATIO else 0
    recovery_count = previous.get("recovery_count", 0) + 1 if ratio < CPU_RECOVERY_RATIO else 0
    overload_alert = bool(previous.get("overload_alert"))
    if not overload_alert and overload_count >= CPU_CONFIRM:
        events.append(f"🔥 HM CPU 持续超载：{usage:.2f}/{limit}（{ratio * 100:.0f}%）")
        overload_alert = True
        recovery_count = 0
    elif overload_alert and recovery_count >= CPU_CONFIRM:
        events.append(f"✅ HM CPU 负载恢复：{usage:.2f}/{limit}（{ratio * 100:.0f}%）")
        overload_alert = False
        overload_count = 0

    old_bucket = previous.get("last_bucket")
    declining = isinstance(old_bucket, (int, float)) and bucket < old_bucket
    decline_count = previous.get("decline_count", 0) + 1 if declining else 0
    stable_count = previous.get("stable_count", 0) + 1 if old_bucket is not None and not declining else 0
    decline_alert = bool(previous.get("decline_alert"))
    decline_start = previous.get("decline_start")
    if declining and previous.get("decline_count", 0) == 0:
        decline_start = old_bucket
    if not decline_alert and decline_count >= CPU_CONFIRM:
        events.append(f"📉 HM CPU Bucket 持续下降：{decline_start:.0f} → {bucket:.0f}")
        decline_alert = True
        stable_count = 0
    elif decline_alert and stable_count >= CPU_CONFIRM:
        events.append(f"✅ HM CPU Bucket 已停止下降：当前 {bucket:.0f}")
        decline_alert = False
        decline_count = 0
        decline_start = None

    bot_usage = current.get("botUsage10")
    official_usage = current.get("officialUsage")
    mismatch_alert = bool(previous.get("mismatch_alert"))
    mismatch_count = previous.get("mismatch_count", 0)
    mismatch_recovery = previous.get("mismatch_recovery", 0)
    if isinstance(bot_usage, (int, float)) and isinstance(official_usage, (int, float)):
        mismatch = abs(bot_usage - official_usage) > max(2.0, abs(official_usage) * 0.2)
        mismatch_count = mismatch_count + 1 if mismatch else 0
        mismatch_recovery = 0 if mismatch else mismatch_recovery + 1
        if not mismatch_alert and mismatch_count >= CPU_CONFIRM:
            events.append(f"⚠️ CPU 统计口径偏差：bot 10 Tick={bot_usage:.2f}，官方连续样本={official_usage:.2f}")
            mismatch_alert = True
            mismatch_recovery = 0
        elif mismatch_alert and mismatch_recovery >= CPU_CONFIRM:
            events.append("✅ CPU 官方样本与 bot 统计已接近")
            mismatch_alert = False
            mismatch_count = 0

    def band(value: float) -> str:
        if value < CPU_BUCKET_CRITICAL:
            return "critical"
        if value < CPU_BUCKET_WARN:
            return "warn"
        return "normal"

    old_band = previous.get("bucket_band")
    new_band = band(bucket)
    if old_band is not None and old_band != new_band:
        if new_band == "critical":
            events.append(f"🚨 HM CPU Bucket 跌破 {CPU_BUCKET_CRITICAL}：当前 {bucket:.0f}")
        elif new_band == "warn":
            events.append(f"⚠️ HM CPU Bucket 进入警戒区：当前 {bucket:.0f}")
        else:
            events.append(f"✅ HM CPU Bucket 恢复至 {CPU_BUCKET_WARN} 以上：当前 {bucket:.0f}")

    history = list(previous.get("history") or [])[-(CPU_HISTORY_LIMIT - 1):]
    history.append({"ts": int(time.time()), **current})
    return events, {
        "history": history,
        "last_bucket": bucket,
        "bucket_band": new_band,
        "overload_count": overload_count,
        "recovery_count": recovery_count,
        "overload_alert": overload_alert,
        "decline_count": decline_count,
        "stable_count": stable_count,
        "decline_alert": decline_alert,
        "decline_start": decline_start,
        "mismatch_count": mismatch_count,
        "mismatch_recovery": mismatch_recovery,
        "mismatch_alert": mismatch_alert,
    }


def owned_rooms() -> list[str]:
    data = api("userRooms", USER_ID)
    return sorted((data.get("shards") or {}).get(SHARD) or [])


def room_objects(room_name: str) -> list[dict[str, Any]]:
    data = api("gameRoomObjects", room_name, SHARD)
    return data.get("objects", data) if isinstance(data, dict) else data


def overview_window(room_name: str) -> tuple[float, float, float]:
    data = api("gameRoomOverview", room_name, "8", SHARD)
    stats = data.get("stats", {})

    def total(key: str) -> float:
        return sum(point.get("value", 0) or 0 for point in stats.get(key, []))

    return total("creepsLost"), total("creepsProduced"), total("energyHarvested")


def hostile_summary(objects: list[dict[str, Any]], users: Any = None) -> tuple[dict[str, Any], dict[str, Any]]:
    """汇总敌方 Creep，返回 (hostiles, scouts)。

    hostiles：带战斗部件（近/远/疗/拆任一 > 0）的单位，参与敌情通知；
    scouts：无任何战斗部件的纯侦察兵，只进快照/journal 供复盘，不触发敌情事件。
    """
    user_names = {
        str(user_id): info.get("username", str(user_id))
        for user_id, info in (users or {}).items()
        if isinstance(info, dict)
    }
    hostiles: dict[str, Any] = {}
    scouts: dict[str, Any] = {}
    for creep in objects:
        if creep.get("type") != "creep" or creep.get("user") in (None, USER_ID):
            continue
        owner = user_names.get(str(creep.get("user")), str(creep.get("user")))
        combat = {"attack": 0, "ranged": 0, "heal": 0, "work": 0}
        for part in creep.get("body") or []:
            if isinstance(part, str):
                part_type, hits = part, 100
            else:
                part_type, hits = part.get("type"), part.get("hits", 100)
            if not hits:
                continue
            if part_type == "attack":
                combat["attack"] += 1
            elif part_type == "ranged_attack":
                combat["ranged"] += 1
            elif part_type == "heal":
                combat["heal"] += 1
            elif part_type == "work":
                combat["work"] += 1
        if sum(combat.values()) > 0:
            entry = hostiles.setdefault(owner, {"count": 0, "attack": 0, "ranged": 0, "heal": 0, "work": 0})
            entry["count"] += 1
            for key, value in combat.items():
                entry[key] += value
        else:
            scout = scouts.setdefault(owner, {"count": 0})
            scout["count"] += 1
    return hostiles, scouts


def downgrade_band(ticks: Any) -> str:
    if not isinstance(ticks, (int, float)):
        return "unknown"
    if ticks < DOWNGRADE_CRITICAL_TICKS:
        return "critical"
    if ticks < DOWNGRADE_WARN_TICKS:
        return "warn"
    return "normal"


def format_hostiles(hostiles: dict[str, Any]) -> str:
    parts = []
    for owner, info in sorted(hostiles.items()):
        combat = f"近{info.get('attack', 0)}/远{info.get('ranged', 0)}/疗{info.get('heal', 0)}/拆{info.get('work', 0)}"
        parts.append(f"{owner} {info.get('count', 0)} 个（{combat}）")
    return "、".join(parts)


def should_notify_event(event: str) -> bool:
    """判断事件是否值得立即投递；完整事件仍全部写入 journal。"""
    if event.startswith("💬 "):
        return True

    if "发现敌方 Creep" in event or "敌情变化" in event:
        match = re.search(r"近(\d+)/远(\d+)/疗(\d+)/拆(\d+)", event)
        return bool(match and sum(int(value) for value in match.groups()) > 0)

    quiet_fragments = (
        "敌方 Creep 已清除",
        "刚发生战斗",
        "HM 启用外矿",
        "HM 停用外矿",
        "CPU Bucket 持续下降",
        "CPU Bucket 已停止下降",
        "Storage 能量骤降",
        "升到 RCL",
    )
    if any(fragment in event for fragment in quiet_fragments):
        return False

    urgent_fragments = (
        "近一小时损失",
        "控制器易主",
        "控制器降级倒计时",
        "房间 ",
        "Spawn 没了",
        "Storage 不见了",
        "Terminal 不见了",
        "Tower 减少",
        "安全模式",
        "核弹正飞向",
        "掉级",
        "新房间",
        "开始扩张",
        "扩张目标",
        "核心进程",
        "外矿 Operation",
        "CPU 持续超载",
        "CPU 负载恢复",
        "CPU Bucket 跌破",
        "CPU Bucket 进入警戒区",
        "CPU Bucket 恢复",
        "GCL 变化",
    )
    return any(fragment in event for fragment in urgent_fragments)


def collect_official(previous: Any) -> tuple[dict[str, Any], list[str]]:
    auth = api("authMe")
    if auth.get("_id") != USER_ID:
        raise RuntimeError(f"认证账号不符：{auth.get('_id')}")

    room_names = owned_rooms()
    tick_data = api("gameTime", SHARD)
    current_tick = tick_data.get("time")
    rooms: dict[str, Any] = {}
    overviews: dict[str, tuple[float, float, float]] = {}
    for room_name in room_names:
        try:
            object_data = api("gameRoomObjects", room_name, SHARD)
            objects = object_data.get("objects", object_data) if isinstance(object_data, dict) else object_data
            controller = next((obj for obj in objects if obj.get("type") == "controller"), {})
            spawns = [obj for obj in objects if obj.get("type") == "spawn" and obj.get("user") == USER_ID]
            storage = next((obj for obj in objects if obj.get("type") == "storage" and obj.get("user") == USER_ID), None)
            terminal = next((obj for obj in objects if obj.get("type") == "terminal" and obj.get("user") == USER_ID), None)
            towers = [obj for obj in objects if obj.get("type") == "tower" and obj.get("user") == USER_ID]
            construction_sites = [obj for obj in objects if obj.get("type") == "constructionSite" and obj.get("user") == USER_ID]
            downgrade_ticks = controller.get("downgradeTime") - current_tick if controller.get("downgradeTime") and current_tick else None
            hostiles, scouts = hostile_summary(objects, object_data.get("users") if isinstance(object_data, dict) else None)
            site_counts: dict[str, int] = {}
            for site in construction_sites:
                structure_type = site.get("structureType") or "unknown"
                site_counts[structure_type] = site_counts.get(structure_type, 0) + 1
            rooms[room_name] = {
                "rcl": controller.get("level"),
                "user": controller.get("user"),
                "safeMode": controller.get("safeMode"),
                "downgradeTicks": downgrade_ticks,
                "spawns": len(spawns),
                "spawning": sorted(
                    spawn.get("spawning", {}).get("name")
                    for spawn in spawns
                    if isinstance(spawn.get("spawning"), dict) and spawn["spawning"].get("name")
                ),
                "storage": bool(storage),
                "storageEnergy": (storage.get("store") or {}).get("energy") if storage else None,
                "terminal": bool(terminal),
                "towers": len(towers),
                "towerEnergy": sum((tower.get("store") or {}).get("energy", 0) for tower in towers),
                "constructionSites": site_counts,
                "hostiles": hostiles,
                "scouts": scouts,
            }
            overviews[room_name] = overview_window(room_name)
        except Exception:  # 单房采样失败不把房间误判为丢失
            if isinstance(previous, dict) and room_name in (previous.get("rooms") or {}):
                rooms[room_name] = previous["rooms"][room_name]

    try:
        nuke_data = api("experimentalNukes").get("nukes", {})
        nukes = [
            {"id": item.get("_id"), "target": item.get("room"), "landTime": item.get("landTime"), "launch": item.get("launchRoomName")}
            for item in nuke_data.get(SHARD, [])
            if item.get("room") in room_names
        ]
    except Exception:
        nukes = []

    try:
        pvp_data = api("experimentalPvp", str(PVP_WINDOW_TICKS)).get("pvp", {})
        pvp = {
            item.get("_id"): item.get("lastPvpTime")
            for item in (pvp_data.get(SHARD, {}) or {}).get("rooms", [])
            if item.get("_id") in room_names
        }
    except Exception:
        pvp = {}

    events: list[str] = []
    previous = previous if isinstance(previous, dict) else None
    lost_alerts = dict((previous or {}).get("lost_alerts") or {})
    current_gcl = gcl_level(auth.get("gcl"))
    if previous:
        old_rooms = previous.get("rooms") or {}
        for room_name, room in sorted(rooms.items()):
            old = old_rooms.get(room_name)
            if old is None:
                events.append(f"🆕 新房间 {room_label(room_name)}：RCL {room.get('rcl')}，已纳入监控")
                continue
            if old.get("rcl") != room.get("rcl"):
                if (room.get("rcl") or 0) > (old.get("rcl") or 0):
                    events.append(f"📈 {room_label(room_name)} 升到 RCL {room.get('rcl')}")
                else:
                    events.append(f"🚨 {room_label(room_name)} 掉级：RCL {old.get('rcl')} → {room.get('rcl')}")
            if old.get("user") != room.get("user"):
                events.append(f"🚨 {room_label(room_name)} 控制器易主：{old.get('user')} → {room.get('user')}")
            if old.get("spawns", 0) > 0 and room.get("spawns", 0) == 0:
                events.append(f"🚨 {room_label(room_name)} 的 Spawn 没了")
            if old.get("storage") and not room.get("storage"):
                events.append(f"⚠️ {room_label(room_name)} 的 Storage 不见了")
            if old.get("terminal") and not room.get("terminal"):
                events.append(f"⚠️ {room_label(room_name)} 的 Terminal 不见了")
            if old.get("towers", 0) > room.get("towers", 0):
                events.append(f"🚨 {room_label(room_name)} Tower 减少：{old.get('towers')} → {room.get('towers')}")
            if not old.get("safeMode") and room.get("safeMode"):
                events.append(f"🛡️ {room_label(room_name)} 安全模式已激活")
            elif old.get("safeMode") and not room.get("safeMode"):
                events.append(f"⚠️ {room_label(room_name)} 安全模式已失效")
            if not old.get("hostiles") and room.get("hostiles"):
                events.append(f"🚨 {room_label(room_name)} 发现敌方 Creep：{format_hostiles(room['hostiles'])}")
            elif old.get("hostiles") and not room.get("hostiles"):
                events.append(f"✅ {room_label(room_name)} 敌方 Creep 已清除")
            elif old.get("hostiles") != room.get("hostiles") and room.get("hostiles"):
                events.append(f"⚔️ {room_label(room_name)} 敌情变化：{format_hostiles(room['hostiles'])}")

            old_band = downgrade_band(old.get("downgradeTicks"))
            new_band = downgrade_band(room.get("downgradeTicks"))
            if old_band != new_band and new_band in ("warn", "critical"):
                icon = "🚨" if new_band == "critical" else "⚠️"
                events.append(f"{icon} {room_label(room_name)} 控制器降级倒计时仅剩 {room.get('downgradeTicks'):.0f} Tick")
            elif old_band in ("warn", "critical") and new_band == "normal":
                events.append(f"✅ {room_label(room_name)} 控制器降级风险解除")

            old_energy = old.get("storageEnergy")
            new_energy = room.get("storageEnergy")
            if all(isinstance(value, (int, float)) for value in (old_energy, new_energy)) and old_energy > 0:
                drop = old_energy - new_energy
                if drop >= STORAGE_ENERGY_DROP_MIN and drop / old_energy >= STORAGE_ENERGY_DROP_RATIO:
                    events.append(f"📉 {room_label(room_name)} Storage 能量骤降：{old_energy:.0f} → {new_energy:.0f}")

            lost, produced, _ = overviews.get(room_name, (0, 0, 0))
            if lost > LOST_THRESHOLD and time.time() - lost_alerts.get(room_name, 0) > 8 * 3600:
                events.append(f"💥 {room_label(room_name)} 近一小时损失 {lost:g} 个 Creep" + (f"（产 {produced:g}）" if produced else ""))
                lost_alerts[room_name] = int(time.time())

        for room_name in sorted(set(old_rooms) - set(rooms)):
            events.append(f"🚨 房间 {room_label(room_name)} 从名下消失（被夺或放弃）")

        old_nukes = set(previous.get("nuke_ids") or [])
        for nuke in nukes:
            if nuke.get("id") not in old_nukes:
                eta = nuke.get("landTime") - current_tick if nuke.get("landTime") and current_tick else None
                events.append(f"☢️ 核弹正飞向 {room_label(nuke['target'])}（来自 {nuke.get('launch')}，剩余 {eta if eta is not None else '?'} Tick）")

        old_pvp = previous.get("pvp") or {}
        for room_name, last_pvp in pvp.items():
            if last_pvp > old_pvp.get(room_name, 0):
                events.append(f"⚔️ {room_label(room_name)} 刚发生战斗")

        old_gcl = previous.get("gcl_level")
        if old_gcl and old_gcl != current_gcl:
            events.append(f"🏆 GCL 变化：{old_gcl} → {current_gcl}")

    state = {
        "ts": int(time.time()),
        "tick": current_tick,
        "gcl_level": current_gcl,
        "cpu_limit": (auth.get("cpuShard") or {}).get(SHARD, auth.get("cpu")),
        "rooms": rooms,
        "nuke_ids": sorted(nuke.get("id") for nuke in nukes if nuke.get("id")),
        "pvp": pvp,
        "lost_alerts": lost_alerts,
    }
    return state, events


def mine_operations(operations: Any) -> dict[str, Any]:
    """保留原生 HM mine:<room> 的原始运行与经济统计，忽略旧 TI 影子 operation。"""
    if not isinstance(operations, dict):
        return {}

    mines: dict[str, Any] = {}
    for key, value in operations.items():
        if not key.startswith("mine:") or not isinstance(value, dict):
            continue
        mines[key[5:]] = {
            "lastActive": value.get("lastActive"),
            "currentTick": value.get("currentTick"),
            "statTicks": value.get("statTicks"),
            "age": value.get("age"),
            "shouldTerminate": value.get("shouldTerminate", False),
            "stats": value.get("stats") or {},
            "status": value.get("status") or {},
        }
    return mines


def room_operation_cpu(operations: Any) -> dict[str, float]:
    result: dict[str, float] = {}
    if not isinstance(operations, dict):
        return result
    for key, value in operations.items():
        if not key.startswith("room:") or not isinstance(value, dict):
            continue
        ticks = value.get("statTicks")
        cpu = (value.get("stats") or {}).get("cpu")
        if isinstance(ticks, (int, float)) and ticks > 0 and isinstance(cpu, (int, float)):
            result[key[5:]] = round(cpu / ticks, 4)
    return result


def collect_hm(previous: Any, official: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    # 先采官方连续 Tick，再读取 Memory，使官方样本与 bot 10 Tick 窗口尽量重叠。
    official_sample = official_cpu_sample()
    strategy = memory("strategy") or {}
    history = memory("history") or {}
    operations = memory("operations") or {}
    hivemind = memory("hivemind") or {}
    bot_usage_10 = history_value(history, "cpu_total", 10)
    bot_usage_100 = history_value(history, "cpu_total", 100)
    bot_usage_1000 = history_value(history, "cpu_total", 1000)
    bot_ratio_100 = history_value(history, "cpu_ratio", 100)
    bucket_average_100 = history_value(history, "bucket", 100)
    bucket_delta = history_value(history, "bucket_delta", 100)
    creeps = history_value(history, "creeps", 100)
    cpu_stats = hivemind.get("cpuStats") or {}
    bucket = cpu_stats.get("lastCompletedBucket", bucket_average_100)
    official_usage = official_sample.get("mean") if official_sample else None
    cpu_limit = official.get("cpu_limit")
    usage = official_usage if isinstance(official_usage, (int, float)) else bot_usage_100

    remote_strategy = strategy.get("remoteHarvesting") or {}
    remotes = sorted(remote_strategy.get("rooms") or [])
    expansion = (strategy.get("expand") or {}).get("currentTarget")
    mines = mine_operations(operations)
    process = hivemind.get("process") or {}
    root_processes = {
        name: info.get("lastRun")
        for name, info in process.items()
        if isinstance(info, dict) and info.get("parentId") == "root"
    }

    previous_cpu_stats = ((previous or {}).get("cpu_stats") or {}) if isinstance(previous, dict) else {}
    previous_unrecorded = previous_cpu_stats.get("unrecordedTicks", 0)
    current_unrecorded = cpu_stats.get("unrecordedTicks", 0)
    unrecorded_delta = current_unrecorded - previous_unrecorded if isinstance(current_unrecorded, int) and isinstance(previous_unrecorded, int) else None

    cpu_current = {
        "usage": round(usage, 4) if isinstance(usage, (int, float)) else None,
        "usageSource": "official" if isinstance(official_usage, (int, float)) else "bot",
        "limit": cpu_limit,
        "officialUsage": round(official_usage, 4) if isinstance(official_usage, (int, float)) else None,
        "botUsage10": round(bot_usage_10, 4) if isinstance(bot_usage_10, (int, float)) else None,
        "botUsage100": round(bot_usage_100, 4) if isinstance(bot_usage_100, (int, float)) else None,
        "botUsage1000": round(bot_usage_1000, 4) if isinstance(bot_usage_1000, (int, float)) else None,
        "botRatio100": round(bot_ratio_100, 6) if isinstance(bot_ratio_100, (int, float)) else None,
        "bucket": round(bucket, 2) if isinstance(bucket, (int, float)) else None,
        "bucketAverage100": round(bucket_average_100, 2) if isinstance(bucket_average_100, (int, float)) else None,
        "bucketDelta": round(bucket_delta, 4) if isinstance(bucket_delta, (int, float)) else None,
        "creeps": round(creeps, 2) if isinstance(creeps, (int, float)) else None,
        "tickCompletion": cpu_stats,
        "roomCpu": room_operation_cpu(operations),
        "official": official_sample,
    }

    previous = previous if isinstance(previous, dict) else None
    events: list[str] = []
    cpu_lines, cpu_state = cpu_events(cpu_current, (previous or {}).get("cpu_monitor"))
    if previous:
        events.extend(cpu_lines)
        if isinstance(unrecorded_delta, int) and unrecorded_delta > 0:
            events.append(f"⚠️ Bot 有 {unrecorded_delta} 个 Tick 未写入尾部 CPU 统计")
        old_remotes = set(previous.get("remotes") or [])
        new_remotes = set(remotes)
        pending_add = dict(previous.get("pending_remote_add") or {})
        pending_del = dict(previous.get("pending_remote_del") or {})
        for room_name in list(pending_add):
            if room_name not in new_remotes:
                pending_add.pop(room_name, None)
        for room_name in list(pending_del):
            if room_name in new_remotes:
                pending_del.pop(room_name, None)
        for room_name in sorted(new_remotes - old_remotes):
            count = pending_add.get(room_name, 0) + 1
            if count >= DEBOUNCE_CONFIRM:
                events.append(f"🆕 HM 启用外矿 {room_name}（主房 {room_label((strategy.get('roomList', {}).get(room_name) or {}).get('origin', '?'))}）")
                old_remotes.add(room_name)
                pending_add.pop(room_name, None)
            else:
                pending_add[room_name] = count
        for room_name in sorted(old_remotes - new_remotes):
            count = pending_del.get(room_name, 0) + 1
            if count >= DEBOUNCE_CONFIRM:
                events.append(f"🔄 HM 停用外矿 {room_name}")
                old_remotes.discard(room_name)
                pending_del.pop(room_name, None)
            else:
                pending_del[room_name] = count

        old_expansion = previous.get("expansion")
        old_target = old_expansion.get("roomName") if isinstance(old_expansion, dict) else None
        new_target = expansion.get("roomName") if isinstance(expansion, dict) else None
        if old_target != new_target:
            if new_target:
                events.append(f"🏗️ HM 开始扩张 {new_target}（出发房 {expansion.get('spawnRoom', '?')}）")
            elif old_target:
                events.append(f"✅ HM 扩张目标 {old_target} 已结束或取消")

        old_mines = previous.get("mines") or {}
        for room_name, mine in sorted(mines.items()):
            old = old_mines.get(room_name)
            if old and mine.get("lastActive") and old.get("lastActive") and mine["lastActive"] < old["lastActive"]:
                events.append(f"⚠️ HM 外矿 Operation {room_name} 活跃 Tick 倒退")

        tick = official.get("tick")
        stale_alert = bool(previous.get("process_stale_alert"))
        stale = []
        if isinstance(tick, int):
            for name in ("init", "creeps", "rooms"):
                last_run = root_processes.get(name)
                if isinstance(last_run, int) and tick - last_run > PROCESS_STALE_TICKS:
                    stale.append(f"{name}({tick - last_run} Tick)")
        if stale and not stale_alert:
            events.append("🚨 HM 核心进程停滞：" + "、".join(stale))
            stale_alert = True
        elif not stale and stale_alert:
            events.append("✅ HM 核心进程已恢复")
            stale_alert = False
    else:
        old_remotes = set(remotes)
        pending_add = {}
        pending_del = {}
        stale_alert = False

    state = {
        "ts": int(time.time()),
        "remotes": sorted(old_remotes),
        "observed_remotes": remotes,
        "pending_remote_add": pending_add,
        "pending_remote_del": pending_del,
        "expansion": expansion,
        "mines": mines,
        "room_list": strategy.get("roomList") or {},
        "root_processes": root_processes,
        "process_stale_alert": stale_alert,
        "cpu_stats": cpu_stats,
        "cpu_monitor": cpu_state,
    }
    return state, events


def collect_squisher(previous: Any) -> tuple[dict[str, Any], list[str]]:
    previous = previous if isinstance(previous, dict) else {}
    latest = None
    try:
        messages = api("userMessagesIndex").get("messages", []) or []
        for thread in messages:
            message = thread.get("message") or {}
            if str(message.get("respondent") or "") == SQUISHER_ID and message.get("type") == "in":
                latest = message
                break
    except Exception:
        pass

    events: list[str] = []
    if latest and latest.get("_id") != previous.get("last_message_id"):
        suffix = "（未读）" if latest.get("unread") else ""
        events.append(f"💬 {SQUISHER} 回复：{(latest.get('text') or '').strip()}{suffix}")
    return {
        "last_message_id": latest.get("_id") if latest else previous.get("last_message_id"),
    }, events


def main() -> None:
    ROOM_NAMES.update(load_json(ROOM_NAMES_FILE) or {})
    previous = load_json(STATE_FILE)
    official_previous = (previous or {}).get("official")
    hm_previous = (previous or {}).get("hm")
    diplomacy_previous = (previous or {}).get("diplomacy")

    # 独立保存完整顶层 Memory 原样快照，摘要采集逻辑仍按原字段读取。
    raw_memory = memory("") or {}
    save_raw_memory_snapshot(raw_memory, time.time())

    official_state, official_events = collect_official(official_previous)
    hm_state, hm_events = collect_hm(hm_previous, official_state)
    diplomacy_state, diplomacy_events = collect_squisher(diplomacy_previous)

    first_run = previous is None
    state = {
        "version": 1,
        "ts": int(time.time()),
        "official": official_state,
        "hm": hm_state,
        "diplomacy": diplomacy_state,
    }
    save_json(STATE_FILE, state)

    cpu_history = (hm_state.get("cpu_monitor") or {}).get("history") or []
    append_journal({
        "ts": state["ts"],
        "events": official_events + hm_events + diplomacy_events,
        "official_rooms": official_state.get("rooms") or {},
        "hm": {
            "remotes": hm_state.get("observed_remotes") or [],
            "expansion": hm_state.get("expansion"),
            "mines": hm_state.get("mines") or {},
            "room_list": hm_state.get("room_list") or {},
        },
        "cpu": cpu_history[-1] if cpu_history else None,
    })

    if first_run:
        rooms = "、".join(room_label(name) for name in sorted((official_state.get("rooms") or {}))) or "无"
        remotes = "、".join(hm_state.get("observed_remotes") or []) or "无"
        expansion = hm_state.get("expansion")
        lines = [
            "🟢 Hivemind 监控已启用（shard2，事件驱动）",
            f"• 主房：{rooms}",
            f"• HM 外矿：{remotes}",
        ]
        if expansion:
            lines.append(f"• 正在扩张：{expansion.get('roomName')}（出发房 {expansion.get('spawnRoom')}）")
        lines.append("之后只报告状态转折；无事件时静默。")
        print("\n".join(lines))
        return

    notify_official = [event for event in official_events if should_notify_event(event)]
    notify_hm = [event for event in hm_events if should_notify_event(event)]
    notify_diplomacy = [event for event in diplomacy_events if should_notify_event(event)]

    parts = []
    if notify_official:
        parts.append("【Screeps】\n" + "\n".join(notify_official))
    if notify_hm:
        parts.append("【Hivemind shard2】\n" + "\n".join(notify_hm))
    if notify_diplomacy:
        parts.append("【squisher 外交】\n" + "\n".join(notify_diplomacy))
    if parts:
        print("\n\n".join(parts))


if __name__ == "__main__":
    try:
        main()
    except RateLimitedError:
        pass
    except Exception as error:  # noqa: BLE001
        print(f"Screeps HM 监控异常：{error}", file=sys.stderr)
        sys.exit(1)
