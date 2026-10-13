import os
import re
import time
import json
import base64
import logging
from urllib.parse import quote
from flask import Blueprint, jsonify, Response

# HTTP client yang bisa impersonate TLS fingerprint browser
from curl_cffi import requests as curl_requests

player_bp = Blueprint('player_bp', __name__)

USERNAME_REGEX = re.compile(r'^[a-zA-Z0-9_]{3,16}$')
UUID_REGEX = re.compile(r'^[a-zA-Z0-9-]{32,36}$')
STEVE_UUID = "8667ba71b85a4004af54457a9734eed7"

# Session dengan impersonate Chrome — bypass Cloudflare TLS fingerprint
SESSION = curl_requests.Session(impersonate="chrome")

_cache, _CACHE_TTL = {}, 60
_icontier_cache = None
_profile_cache, _PROFILE_CACHE_TTL = {}, 300
_skin_cache, _SKIN_CACHE_TTL = {}, 300


def get_config_path(filename):
    return os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config', filename)


def load_providers():
    try:
        with open(get_config_path("providers.json"), "r", encoding="utf-8") as f:
            return json.load(f).get("providers", [])
    except Exception as e:
        logging.error(f"Gagal memuat providers.json: {e}")
        return []


def load_icontier():
    global _icontier_cache
    if _icontier_cache is not None:
        return _icontier_cache
    try:
        with open(get_config_path("icontier.json"), "r", encoding="utf-8") as f:
            _icontier_cache = json.load(f)
    except Exception as e:
        logging.error(f"Gagal memuat icontier.json: {e}")
        _icontier_cache = {"ITEM_ICONS": {}, "MODE_ALIASES": {}, "MODE_DISPLAY_NAMES": {}}
    return _icontier_cache


def make_headers(referer: str, origin: str = None) -> dict:
    h = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": referer,
    }
    if origin:
        h["Origin"] = origin
    return h


# ============================================================
# Mojang Profile Lookup
# ============================================================

def _fetch_profile(url):
    """Coba satu endpoint profile lookup. Return (uuid, name) atau (None, None)."""
    try:
        res = SESSION.get(
            url,
            headers={"Accept": "application/json"},
            timeout=8,
        )
        if res.status_code == 200:
            data = res.json()
            return data.get("id"), data.get("name")
        logging.warning(f"Profile lookup non-200 ({res.status_code}) dari {url}")
    except Exception as e:
        logging.warning(f"Profile lookup gagal untuk {url}: {e}")
    return None, None


def get_player_profile(username):
    key = username.lower()
    cached = _profile_cache.get(key)
    if cached and (time.time() - cached[0]) < _PROFILE_CACHE_TTL:
        return cached[1]

    result = _fetch_profile(f"https://api.mojang.com/users/profiles/minecraft/{username}")

    if result[0] is None:
        result = _fetch_profile(
            f"https://api.minecraftservices.com/minecraft/profile/lookup/name/{username}"
        )

    _profile_cache[key] = (time.time(), result)
    return result


# ============================================================
# Skin Data
# ============================================================

def get_skin_data(uuid):
    key = uuid.lower()
    cached = _skin_cache.get(key)
    if cached and (time.time() - cached[0]) < _SKIN_CACHE_TTL:
        return cached[1]

    result = {"url": None, "model": "classic", "cape": None}
    try:
        res = SESSION.get(
            f"https://sessionserver.mojang.com/session/minecraft/profile/{uuid}?unsigned=false",
            headers={"Accept": "application/json"},
            timeout=8,
        )
        if res.status_code == 200:
            for prop in res.json().get("properties", []):
                if prop.get("name") == "textures":
                    decoded = json.loads(base64.b64decode(prop["value"]))
                    textures = decoded.get("textures", {})
                    skin = textures.get("SKIN", {})
                    cape = textures.get("CAPE", {})
                    is_slim = skin.get("metadata", {}).get("model") == "slim"
                    result = {
                        "url": skin.get("url"),
                        "model": "slim" if is_slim else "classic",
                        "cape": cape.get("url"),
                    }
                    break
        else:
            logging.warning(f"sessionserver non-200 ({res.status_code}) untuk UUID {uuid}")
    except Exception as e:
        logging.warning(f"Gagal ambil skin resmi untuk UUID {uuid}: {e}")

    _skin_cache[key] = (time.time(), result)
    return result


# ============================================================
# Tier Parsing
# ============================================================

def clean_rank(mode_key, value):
    if value is None:
        return None
    if isinstance(value, str):
        rank = value.strip()
        if not rank or rank.lower() in ("unranked", "none", "n/a", "-", "untested"):
            return None
        return rank.upper()
    if isinstance(value, dict):
        if value.get("retired") is True and not value.get("tier"):
            return None
        tier_val = value.get("tier", value.get("rank", value.get("value")))
        if tier_val is None:
            return None
        tier_val = str(tier_val).strip()
        if not tier_val or tier_val.lower() in ("unranked", "none", "n/a", "0"):
            return None
        if tier_val[:2].upper() in ("HT", "LT"):
            return tier_val.upper()

        pos = value.get("pos", value.get("position", value.get("type")))
        is_low = value.get("isLT")
        if is_low is True:
            prefix = "LT"
        elif is_low is False:
            prefix = "HT"
        elif isinstance(pos, str) and pos.lower().startswith("low"):
            prefix = "LT"
        elif isinstance(pos, str) and pos.lower().startswith("high"):
            prefix = "HT"
        elif isinstance(pos, bool):
            prefix = "LT" if pos else "HT"
        elif isinstance(pos, int):
            prefix = "HT" if pos == 0 else "LT"
        else:
            prefix = "T"
        return f"{prefix}{tier_val}"
    return None


def find_modes(data, depth=0):
    if not isinstance(data, dict) or depth > 3:
        return {}
    for wrapper in ("data", "player", "profile", "result"):
        inner = data.get(wrapper)
        if isinstance(inner, dict):
            found = find_modes(inner, depth + 1)
            if found:
                return found
    for key in ("gameModes", "rankings", "tiers", "ladders", "kits", "modes"):
        val = data.get(key)
        if isinstance(val, dict):
            return val
    known_modes = {
        "vanilla", "axe", "sword", "pot", "neth_pot", "netherite_pot",
        "nethop", "uhc", "smp", "crystal", "mace", "cart", "ltm", "2v2",
    }
    if any(str(k).lower() in known_modes for k in data.keys()):
        return data
    return {}


def unpack_data(data, depth=0):
    payload = data
    while isinstance(payload, dict) and depth < 3:
        moved = False
        for wrapper in ("data", "player", "profile", "result"):
            inner = payload.get(wrapper)
            if isinstance(inner, dict):
                payload = inner
                depth += 1
                moved = True
                break
        if not moved:
            break
    return payload


def parse_tiers(data, icontier):
    payload = unpack_data(data)
    rankings = payload.get("rankings") if isinstance(payload, dict) else None
    results = []

    ALIASES = icontier.get("MODE_ALIASES", {})
    NAMES = icontier.get("MODE_DISPLAY_NAMES", {})
    ICONS = icontier.get("ITEM_ICONS", {})
    default_icon = ICONS.get(
        "default",
        "https://assets.mcasset.cloud/1.21/assets/minecraft/textures/item/barrier.png",
    )

    # Format 1: rankings dict — common di MCTiers v2
    if isinstance(rankings, dict):
        for mode, info in rankings.items():
            if not isinstance(info, dict):
                continue
            tier_num = info.get("tier")
            if tier_num is None:
                continue
            pos = info.get("pos", info.get("position"))
            prefix = "HT" if pos == 0 else "LT"
            m_key = ALIASES.get(mode.lower(), mode.lower())
            results.append({
                "mode": NAMES.get(m_key, m_key.upper()),
                "rank": f"{prefix}{tier_num}",
                "icon": ICONS.get(m_key, default_icon),
            })
        return results

    # Format 2: mode -> info langsung
    for mode, info in find_modes(payload).items():
        rank = clean_rank(mode, info)
        if not rank:
            continue
        m_key = ALIASES.get(mode.lower(), mode.lower())
        results.append({
            "mode": NAMES.get(m_key, m_key.upper()),
            "rank": rank,
            "icon": ICONS.get(m_key, default_icon),
        })
    return results


# ============================================================
# Tier Fetching
# ============================================================

def get_tier_data(provider, username, history=None):
    p_id = provider["id"]
    cache_key = (p_id, username.lower())
    if cache_key in _cache and (time.time() - _cache[cache_key][0]) < _CACHE_TTL:
        return _cache[cache_key][1]

    icontier = load_icontier()
    results = []

    try:
        url = provider["url"].format(username=username)
        headers = make_headers(provider.get("referer", ""), provider.get("origin"))
        res = SESSION.get(url, headers=headers, timeout=provider.get("timeout", 8))
        if res.status_code == 200:
            results = parse_tiers(res.json(), icontier)
        else:
            logging.warning(f"[{p_id}] HTTP {res.status_code} untuk {username}")
    except Exception as e:
        logging.warning(f"[{p_id}] Gagal fetch {username}: {e}")

    fallback_id = provider.get("fallback_to")
    if not results and fallback_id and history and fallback_id in history:
        results = history[fallback_id]

    _cache[cache_key] = (time.time(), results)
    return results


# ============================================================
# Routes
# ============================================================

@player_bp.route("/api/download-skin/<uuid>", methods=["GET"])
def download_skin(uuid):
    if not UUID_REGEX.match(uuid):
        return jsonify({"error": "Format UUID tidak valid"}), 400
    try:
        res = SESSION.get(f"https://crafatar.com/skins/{uuid}", timeout=10)
        if res.status_code == 200:
            return Response(
                res.content,
                mimetype="image/png",
                headers={
                    "Content-Disposition": f'attachment; filename="{quote(uuid)}_skin.png"'
                },
            )
    except Exception as e:
        logging.warning(f"Gagal download skin {uuid}: {e}")
    return jsonify({"error": "Gagal mengambil skin"}), 502


@player_bp.route("/api/track/<username>", methods=["GET"])
def track(username):
    if not USERNAME_REGEX.match(username):
        return jsonify({"error": "Invalid username format"}), 400

    uuid_raw, official_name = get_player_profile(username)
    target_name = official_name or username
    target_uuid = uuid_raw or STEVE_UUID

    tier_sources, history = [], {}
    for p in load_providers():
        res = get_tier_data(p, target_name, history)
        history[p["id"]] = res
        tier_sources.append({"provider": p["name"], "tiers": res})

    skin_data = get_skin_data(target_uuid)

    return jsonify({
        "username": target_name,
        "uuid": target_uuid,
        "providers": tier_sources,
        "skins": {
            "avatar_head": f"https://crafatar.com/avatars/{target_uuid}?overlay=true",
            "body_render": f"https://visage.surgeplay.com/full/512/{target_uuid}",
            "raw_skin": skin_data["url"] or f"https://crafatar.com/skins/{target_uuid}",
            "model": skin_data["model"],
            "cape": skin_data["cape"],
        },
    })