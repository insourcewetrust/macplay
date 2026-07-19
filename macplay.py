#!/usr/bin/env python3
"""macplay — one-click Windows gaming on Apple Silicon, for humans.

Prototype CLI. Wraps the Sikarugir/Kegworks stack (Wine + D3DMetal/DXMT/DXVK)
so a non-technical user never has to know what a "wine prefix" is.

Commands:
  detect                 Print this Mac's hardware profile (chip, tier, RAM, GPU).
  games                  List the compatibility database.
  recommend <game>       What backend + in-game settings to use on THIS Mac.
  apply <game>           Set the wrapper's graphics backend for a game (+ optional restart).
  doctor                 Health check: Rosetta, swap pressure, disk, wrapper state.
  restart                Cleanly kill the Wine session and relaunch the Steam wrapper.
  setup-steam            Build a ready-to-use Steam wrapper from scratch (~450 MB download).

Data: data/games.json — schema designed to sync with macgamers-hub (key: steam_appid).
"""

import json
import os
import plistlib
import re
import shutil
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
GAMES_DB = os.path.join(HERE, "data", "games.json")
DEFAULT_WRAPPER = os.path.expanduser("~/Applications/Sikarugir/Steam.app")

TEMPLATE_URL = "https://github.com/Sikarugir-App/Wrapper/releases/download/v1.0/Template-1.0.11.tar.xz"
ENGINE_URL = "https://github.com/Sikarugir-App/Engines/releases/download/v1.0/WS12WineSikarugir10.0_6.tar.xz"
WINETRICKS_URL = "https://raw.githubusercontent.com/Sikarugir-App/winetricks/master/src/winetricks"
STEAM_SETUP_URL = "https://cdn.cloudflare.steamstatic.com/client/installer/SteamSetup.exe"
STEAM_FLAGS = "-allosarches -cef-force-32bit -cef-in-process-gpu -cef-disable-sandbox"

BACKEND_KEYS = {"d3dmetal": "D3DMETAL", "dxmt": "DXMT", "dxvk": "DXVK"}
TIER_ORDER = ["base", "pro", "max", "ultra"]


def sh(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


# ---------------------------------------------------------------- detect

def detect():
    chip = sh(["sysctl", "-n", "machdep.cpu.brand_string"]).stdout.strip()
    ram_gb = round(int(sh(["sysctl", "-n", "hw.memsize"]).stdout.strip()) / (1024 ** 3))
    tier = "base"
    for t in ("Pro", "Max", "Ultra"):
        if chip.endswith(t):
            tier = t.lower()
    gpu_cores = None
    disp = sh(["system_profiler", "SPDisplaysDataType", "-json"])
    try:
        gpu_cores = int(json.loads(disp.stdout)["SPDisplaysDataType"][0]["sppci_cores"])
    except (KeyError, ValueError, IndexError, json.JSONDecodeError):
        pass
    macos = sh(["sw_vers", "-productVersion"]).stdout.strip()
    rosetta = sh(["pgrep", "-q", "oahd"]).returncode == 0 or os.path.exists("/Library/Apple/usr/libexec/oah")
    return {
        "chip": chip,
        "tier": tier,
        "ram_gb": ram_gb,
        "gpu_cores": gpu_cores,
        "macos": macos,
        "rosetta": rosetta,
        "apple_silicon": chip.startswith("Apple"),
    }


# ---------------------------------------------------------------- games db

def load_db():
    with open(GAMES_DB) as f:
        return json.load(f)["games"]


def find_game(query):
    q = query.lower()
    games = load_db()
    for g in games:
        if g["id"] == q or str(g.get("steam_appid")) == q:
            return g
    matches = [g for g in games if q in g["title"].lower()]
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        names = ", ".join(g["id"] for g in matches)
        sys.exit(f"Ambiguous: {names}")
    sys.exit(f"Unknown game '{query}'. Run 'macplay games' to list.")


def settings_for(game, tier):
    s = game.get("settings", {})
    if not s:
        return None
    # exact tier, else walk down to the closest lower tier, else default
    idx = TIER_ORDER.index(tier) if tier in TIER_ORDER else 0
    for t in reversed(TIER_ORDER[: idx + 1]):
        if t in s:
            return s[t]
    return s.get("default")


def cmd_games():
    rows = [(g["id"], g["status"], g["backend"], g["title"]) for g in load_db()]
    w = max(len(r[0]) for r in rows)
    for gid, status, backend, title in rows:
        print(f"{gid:<{w}}  {status:<7} {backend:<9} {title}")


def cmd_recommend(query):
    g = find_game(query)
    hw = detect()
    print(f"# {g['title']}  [{g['status']}]")
    if g["status"] == "blocked":
        print("BLOQUÉ : anticheat/DRM incompatible avec Wine. Ne pas installer via le wrapper.")
        return
    if g["status"] == "native":
        print("VERSION NATIVE MAC DISPONIBLE : joue-la sur le client Steam macOS normal.")
        if not g.get("backend") or g["backend"] == "none":
            return
        print("(Sinon, jouable via wrapper :)")
    if g["status"] == "borked":
        print("NE FONCTIONNE PAS via wrapper.", g.get("notes", ""))
        return
    print(f"Backend graphique : {g['backend'].upper()}  (macplay apply {g['id']})")
    if g.get("dx"):
        print(f"API : {g['dx'].upper()}")
    if g.get("launch_options"):
        print(f"Options de lancement Steam : {g['launch_options']}")
    s = settings_for(g, hw["tier"])
    if s:
        print(f"Réglages in-game ({hw['chip']}, palier '{hw['tier']}') :")
        print(f"  preset={s['preset']}  upscaling={s['upscaling']}" + (f"  {s['extra']}" if s.get("extra") else ""))
    if g.get("ram_min_gb") and hw["ram_gb"] <= g["ram_min_gb"]:
        print(f"⚠ RAM : {hw['ram_gb']} Go installés, minimum pratique {g['ram_min_gb']} Go — ferme navigateurs/IDE avant de jouer.")
    if g.get("notes"):
        print(f"Notes : {g['notes']}")
    for fix in g.get("fixes", []):
        print(f"Si « {fix['symptom']} » → {fix['fix']}")


# ---------------------------------------------------------------- wrapper ops

def wrapper_plist(wrapper):
    return os.path.join(wrapper, "Contents", "Info.plist")


def read_plist(path):
    with open(path, "rb") as f:
        return plistlib.load(f)


def write_plist(path, data):
    with open(path, "wb") as f:
        plistlib.dump(data, f)


def cmd_apply(query, wrapper=DEFAULT_WRAPPER, restart=False):
    g = find_game(query)
    backend = g.get("backend")
    if backend in (None, "none"):
        sys.exit(f"'{g['title']}' n'a pas de backend wrapper ({g['status']}). Rien à appliquer.")
    if not os.path.isdir(wrapper):
        sys.exit(f"Wrapper introuvable : {wrapper} (lance d'abord 'macplay setup-steam')")
    pl = wrapper_plist(wrapper)
    data = read_plist(pl)
    for key in BACKEND_KEYS.values():
        data[key] = 0
    if backend in BACKEND_KEYS:
        data[BACKEND_KEYS[backend]] = 1
    data["MOLTENVKCX"] = 1  # vulkan driver, always on
    write_plist(pl, data)
    active = BACKEND_KEYS.get(backend, "WineD3D (fallback)")
    print(f"Backend réglé sur {active} pour « {g['title']} ».")
    if restart:
        cmd_restart(wrapper)
    else:
        print("Pense à redémarrer la session : macplay restart")


def cmd_restart(wrapper=DEFAULT_WRAPPER):
    launcher = os.path.join(wrapper, "Contents", "MacOS", "wineskinlauncher")
    if not os.path.exists(launcher):
        sys.exit(f"Wrapper introuvable : {wrapper}")
    print("Arrêt de la session Wine…")
    sh([launcher, "WSS-wineserverkill"])
    time.sleep(3)
    print("Relance du wrapper…")
    sh(["open", wrapper])
    print("OK — Steam redémarre avec la config actuelle.")


# ---------------------------------------------------------------- doctor

def cmd_doctor(wrapper=DEFAULT_WRAPPER):
    hw = detect()
    ok = lambda b: "✅" if b else "❌"
    print(f"{ok(hw['apple_silicon'])} Puce : {hw['chip']} ({hw['ram_gb']} Go RAM, {hw['gpu_cores']} cœurs GPU)")
    print(f"{ok(hw['rosetta'])} Rosetta 2 " + ("installé" if hw["rosetta"] else "MANQUANT → softwareupdate --install-rosetta"))

    swap = sh(["sysctl", "-n", "vm.swapusage"]).stdout
    m = re.search(r"total = ([\d.]+)M\s+used = ([\d.]+)M", swap)
    if m:
        total, used = float(m.group(1)), float(m.group(2))
        pct = used / total * 100 if total else 0
        flag = pct < 75
        print(f"{ok(flag)} Swap : {used/1024:.1f}/{total/1024:.1f} Go utilisés ({pct:.0f}%)"
              + ("" if flag else " → mémoire saturée, ferme des apps avant de jouer (source n°1 de lag)"))

    du = shutil.disk_usage("/")
    free_gb = du.free / (1024 ** 3)
    print(f"{ok(free_gb > 30)} Disque : {free_gb:.0f} Go libres")

    if os.path.isdir(wrapper):
        ver_file = os.path.join(wrapper, "Contents", "SharedSupport", "wine", "version")
        ver = open(ver_file).read().strip() if os.path.exists(ver_file) else "?"
        data = read_plist(wrapper_plist(wrapper))
        active = [k for k in BACKEND_KEYS.values() if data.get(k)] or ["WineD3D"]
        print(f"✅ Wrapper : {wrapper}")
        print(f"   moteur : {ver} | backend actif : {', '.join(active)} | cible : {data.get('Program Name and Path')}")
        alive = sh(["pgrep", "-f", "SharedSupport/wine/.*wineserver"]).returncode == 0
        print(f"   session Wine : {'en cours' if alive else 'arrêtée'}")
    else:
        print(f"❌ Wrapper absent ({wrapper}) → macplay setup-steam")


# ---------------------------------------------------------------- setup

def run_launcher_step(launcher, arg, done_check, timeout=600):
    """Run a wineskinlauncher command, working around its GUI event loop:
    the binary finishes its wine work but then idles in [NSApplication run]
    forever when driven headless. We poll a filesystem/process 'done' probe
    and terminate the launcher once the work is provably complete."""
    p = subprocess.Popen([launcher, arg], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    start = time.time()
    confirmed = 0
    while time.time() - start < timeout:
        if p.poll() is not None:
            return  # exited by itself, best case
        if done_check():
            confirmed += 1
            if confirmed >= 3:  # stable across ~6s, work is done
                p.terminate()
                p.wait(timeout=10)
                return
        else:
            confirmed = 0
        time.sleep(2)
    p.terminate()
    raise TimeoutError(f"wineskinlauncher {arg} : délai dépassé ({timeout}s)")


def download(url, dest):
    if os.path.exists(dest):
        print(f"  cache : {os.path.basename(dest)}")
        return
    print(f"  téléchargement : {url}")
    tmp = dest + ".part"
    with urllib.request.urlopen(url) as r, open(tmp, "wb") as f:
        shutil.copyfileobj(r, f)
    os.rename(tmp, dest)


def cmd_setup_steam(wrapper=DEFAULT_WRAPPER, launch=True):
    """Reproduces, end to end, the manual setup validated in session (2026-07)."""
    if os.path.exists(wrapper):
        sys.exit(f"{wrapper} existe déjà. Supprime-le d'abord si tu veux repartir de zéro.")
    cache = os.path.expanduser("~/Library/Caches/macplay")
    os.makedirs(cache, exist_ok=True)
    os.makedirs(os.path.dirname(wrapper), exist_ok=True)

    print("[1/6] Téléchargements (template + moteur Wine + winetricks + SteamSetup)…")
    tpl = os.path.join(cache, "Template.tar.xz")
    eng = os.path.join(cache, "Engine.tar.xz")
    wt = os.path.join(cache, "winetricks")
    ss = os.path.join(cache, "SteamSetup.exe")
    download(TEMPLATE_URL, tpl)
    download(ENGINE_URL, eng)
    download(WINETRICKS_URL, wt)
    download(STEAM_SETUP_URL, ss)
    os.chmod(wt, 0o755)

    print("[2/6] Assemblage du wrapper…")
    work = os.path.join(cache, "work")
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work)
    subprocess.check_call(["tar", "-xf", tpl, "-C", work])
    app_src = next(os.path.join(work, d) for d in os.listdir(work) if d.endswith(".app"))
    shutil.move(app_src, wrapper)
    subprocess.check_call(["tar", "-xf", eng, "-C", work])
    wine_dst = os.path.join(wrapper, "Contents", "SharedSupport", "wine")
    shutil.rmtree(wine_dst, ignore_errors=True)
    shutil.move(os.path.join(work, "wswine.bundle"), wine_dst)

    # dylib fix: outside the launcher, SIP strips DYLD_FALLBACK_LIBRARY_PATH,
    # so wine's @rpath lookups need the wrapper Frameworks visible from wine/lib
    fw = os.path.join(wrapper, "Contents", "Frameworks")
    lib = os.path.join(wine_dst, "lib")
    for name in os.listdir(fw):
        if name.endswith(".dylib") and not os.path.exists(os.path.join(lib, name)):
            os.symlink(f"../../../Frameworks/{name}", os.path.join(lib, name))

    sh(["/usr/bin/xattr", "-drs", "com.apple.quarantine", wrapper])

    print("[3/6] Création du prefix Wine…")
    launcher = os.path.join(wrapper, "Contents", "MacOS", "wineskinlauncher")
    prefix = os.path.join(wrapper, "Contents", "SharedSupport", "prefix")

    def prefix_ready():
        # registry hives written AND this wrapper's wineserver has exited
        regs = all(os.path.exists(os.path.join(prefix, f)) for f in ("system.reg", "user.reg"))
        server = sh(["pgrep", "-f", os.path.join(wrapper, ".*wineserver")]).returncode == 0
        return regs and not server

    run_launcher_step(launcher, "WSS-wineprefixcreate", prefix_ready)

    print("[4/6] Installation de Steam (winetricks : corefonts + workarounds)…")
    wt_cache = os.path.expanduser("~/.cache/winetricks/steam")
    os.makedirs(wt_cache, exist_ok=True)
    shutil.copy(ss, os.path.join(wt_cache, "SteamSetup.exe"))
    env = os.environ.copy()
    env.update({
        "WINEPREFIX": os.path.join(wrapper, "Contents", "SharedSupport", "prefix"),
        "WINE": os.path.join(wine_dst, "bin", "wine"),
        "WINESERVER": os.path.join(wine_dst, "bin", "wineserver"),
        "PATH": os.path.join(wine_dst, "bin") + ":"
                + os.path.join(wrapper, "Contents", "Configure.app", "Contents", "Resources") + ":"
                + env["PATH"],
    })
    subprocess.check_call(["sh", wt, "-q", "steam"], env=env)

    print("[5/6] Configuration du wrapper…")
    pl = wrapper_plist(wrapper)
    data = read_plist(pl)
    data["CFBundleName"] = "Steam"
    data["CFBundleIdentifier"] = "com.macplay.steam"
    data["Program Name and Path"] = "/Program Files (x86)/Steam/Steam.exe"
    data["Program Flags"] = STEAM_FLAGS
    data["D3DMETAL"] = 1  # sane default for modern games
    write_plist(pl, data)

    if launch:
        print("[6/6] Lancement…")
        sh(["open", wrapper])
        print(f"\nPrêt. Steam s'ouvre — connecte-toi et installe tes jeux.\nWrapper : {wrapper}")
    else:
        print(f"\nPrêt (non lancé). Wrapper : {wrapper}")


# ---------------------------------------------------------------- main

def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return
    cmd, rest = args[0], args[1:]
    wrapper = DEFAULT_WRAPPER
    if "--path" in rest:
        i = rest.index("--path")
        wrapper = os.path.expanduser(rest[i + 1])
        rest = rest[:i] + rest[i + 2:]
    if cmd == "detect":
        print(json.dumps(detect(), indent=2, ensure_ascii=False))
    elif cmd == "games":
        cmd_games()
    elif cmd == "recommend" and rest:
        cmd_recommend(rest[0])
    elif cmd == "apply" and rest:
        cmd_apply(rest[0], wrapper=wrapper, restart="--restart" in rest)
    elif cmd == "doctor":
        cmd_doctor(wrapper)
    elif cmd == "restart":
        cmd_restart(wrapper)
    elif cmd == "setup-steam":
        cmd_setup_steam(wrapper, launch="--no-launch" not in rest)
    else:
        sys.exit(f"Commande inconnue ou argument manquant : {cmd}\n{__doc__}")


if __name__ == "__main__":
    main()
