import os
import re
import json
import logging
import concurrent.futures
from urllib.parse import quote
from flask import Blueprint, jsonify, request

from curl_cffi import requests as curl_requests

mod_bp = Blueprint('mod_bp', __name__)

MODRINTH_API_BASE = "https://api.modrinth.com/v2"
MODRINTH_UA = "MinecraftUtilityHub/1.0 (github.com/goomy; contact: goomy)"
ALLOWED_LOADERS = ["fabric", "forge", "neoforge", "quilt"]

SLUG_REGEX = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
VERSION_REGEX = re.compile(r"^\d+\.\d+(\.\d+)?([-_a-zA-Z0-9]{0,20})?$")

SESSION = curl_requests.Session(impersonate="chrome")
_modpacks_cache = None


def get_config_path(filename):
    return os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config', filename)


def load_modpacks():
    global _modpacks_cache
    if _modpacks_cache is not None:
        return _modpacks_cache
    try:
        with open(get_config_path("modpacks.json"), "r", encoding="utf-8") as f:
            _modpacks_cache = json.load(f).get("presets", [])
    except Exception as e:
        logging.error(f"Gagal memuat modpacks.json: {e}")
        _modpacks_cache = []
    return _modpacks_cache


def find_preset(preset_id):
    for preset in load_modpacks():
        if preset["id"] == preset_id:
            return preset
    return None


def _valid_slug(slug):
    return isinstance(slug, str) and bool(SLUG_REGEX.match(slug))


def _valid_version(version):
    return isinstance(version, str) and bool(VERSION_REGEX.match(version))


def _valid_loader(loader):
    return loader in ALLOWED_LOADERS


def fetch_modrinth_url(slug, version, loader):
    if not (_valid_slug(slug) and _valid_version(version) and _valid_loader(loader)):
        logging.warning(f"Input tidak valid: slug={slug!r} version={version!r} loader={loader!r}")
        return None, None

    try:
        query_url = (
            f"{MODRINTH_API_BASE}/project/{slug}/version"
            f"?loaders=[%22{loader}%22]&game_versions=[%22{version}%22]"
        )
        res = SESSION.get(
            query_url,
            headers={"User-Agent": MODRINTH_UA, "Accept": "application/json"},
            timeout=10,
        )
        if res.status_code != 200:
            return None, None

        versions = res.json()
        if not versions:
            return None, None

        files = versions[0].get("files", [])
        target_file = None

        for f in files:
            if f.get("primary") and f.get("filename", "").endswith(".jar"):
                target_file = f
                break

        if not target_file:
            for f in files:
                if f.get("filename", "").endswith(".jar"):
                    target_file = f
                    break

        if not target_file or not target_file.get("url"):
            return None, None

        raw_name = target_file.get("filename", f"{slug}.jar")
        safe_name = os.path.basename(raw_name) if raw_name else f"{slug}.jar"

        url = target_file["url"]
        if not isinstance(url, str) or not url.startswith("https://"):
            return None, None

        return safe_name, url
    except Exception as e:
        logging.warning(f"Gagal memproses mod '{slug}': {e}")
    return None, None


@mod_bp.route("/api/modpacks", methods=["GET"])
def get_modpacks():
    return jsonify({"presets": load_modpacks(), "loaders": ALLOWED_LOADERS})


@mod_bp.route("/api/modpack/check", methods=["POST"])
def check_modpack():
    body = request.get_json(silent=True) or {}
    preset_id = str(body.get("preset_id", ""))
    version = str(body.get("version", ""))
    loader = str(body.get("loader", "")).lower()

    preset = find_preset(preset_id)
    if not preset:
        return jsonify({"error": "Preset tidak ditemukan"}), 404
    if not _valid_version(version):
        return jsonify({"error": "Format versi tidak valid"}), 400
    if not _valid_loader(loader):
        return jsonify({"error": "Mod loader tidak didukung"}), 400

    available, missing = [], []

    def check_mod(mod):
        fname, _ = fetch_modrinth_url(mod["slug"], version, loader)
        return mod["name"], bool(fname)

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        results = list(executor.map(check_mod, preset.get("mods", [])))

    for name, is_avail in results:
        if is_avail:
            available.append(name)
        else:
            missing.append(name)

    return jsonify({"available": available, "missing": missing})


@mod_bp.route("/api/modpack/search", methods=["POST"])
def search_mod():
    body = request.get_json(silent=True) or {}
    query = str(body.get("query", "")).strip()[:80]
    version = str(body.get("version", ""))
    loader = str(body.get("loader", "")).lower()

    if not query:
        return jsonify({"results": []})
    if not _valid_version(version) or not _valid_loader(loader):
        return jsonify({"results": []})

    try:
        facets = f'[["versions:{version}"],["categories:{loader}"]]'
        url = f"{MODRINTH_API_BASE}/search?query={quote(query)}&facets={quote(facets)}&limit=6"
        res = SESSION.get(
            url,
            headers={"User-Agent": MODRINTH_UA, "Accept": "application/json"},
            timeout=8,
        )
        if res.status_code == 200:
            hits = res.json().get("hits", [])
            results = [
                {
                    "slug": h["slug"],
                    "name": h["title"],
                    "desc": h["description"],
                    "icon": h.get("icon_url"),
                }
                for h in hits
            ]
            return jsonify({"results": results})
    except Exception as e:
        logging.error(f"Search modrinth error: {e}")
    return jsonify({"results": []})


@mod_bp.route("/api/modpack/download", methods=["POST"])
def download_modpack():
    body = request.get_json(silent=True) or {}
    preset_id = str(body.get("preset_id", ""))
    version = str(body.get("version", ""))
    loader = str(body.get("loader", "")).lower()
    custom_mods = body.get("custom_mods", [])

    if not _valid_version(version):
        return jsonify({"error": "Format versi tidak valid"}), 400
    if not _valid_loader(loader):
        return jsonify({"error": "Mod loader tidak didukung"}), 400
    if not isinstance(custom_mods, list):
        custom_mods = []
    if len(custom_mods) > 20:
        return jsonify({"error": "Maksimal hanya 20 mod tambahan yang diizinkan sekaligus."}), 400

    sanitized = []
    for m in custom_mods:
        if not isinstance(m, dict):
            continue
        slug = m.get("slug", "")
        if not _valid_slug(slug):
            continue
        name = str(m.get("name", ""))[:80]
        sanitized.append({"slug": slug, "name": name})
    custom_mods = sanitized

    preset = find_preset(preset_id)
    preset_name = preset["name"] if preset else "Custom"
    base_mods = preset.get("mods", []) if preset else []
    all_mods = base_mods + custom_mods

    if not all_mods:
        return jsonify({"error": "Tidak ada mod yang dipilih"}), 400

    download_list, skipped = [], []

    for mod in all_mods:
        filename, url = fetch_modrinth_url(mod["slug"], version, loader)
        if filename and url:
            download_list.append({"name": mod["name"], "filename": filename, "url": url})
        else:
            skipped.append(mod["name"])

    if not download_list:
        return jsonify({
            "error": f"Gagal mendapatkan link satupun mod untuk versi {version} {loader}",
            "skipped": skipped,
        }), 502

    manifest = {
        "preset": preset_name,
        "minecraft_version": version,
        "mod_loader": loader,
        "downloaded_mods": [m["name"] for m in download_list],
        "skipped_mods": skipped,
    }
    return jsonify({"files": download_list, "manifest": manifest, "skipped": skipped})