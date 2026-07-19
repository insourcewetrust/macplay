import Foundation
import AppKit

// MARK: - Models (mirror data/games.json)

struct HardwareProfile {
    let chip: String
    let tier: String
    let ramGB: Int
    let gpuCores: Int?
    let macosVersion: String
    let rosetta: Bool
    let appleSilicon: Bool
}

struct TierSettings: Codable {
    let preset: String
    let upscaling: String
    let extra: String?
}

struct GameFix: Codable, Hashable {
    let symptom: String
    let fix: String
    let symptom_fr: String?
    let fix_fr: String?

    var localizedSymptom: String { L.fr ? (symptom_fr ?? symptom) : symptom }
    var localizedFix: String { L.fr ? (fix_fr ?? fix) : fix }
}

struct GameEntry: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let steam_appid: Int?
    let status: String
    let backend: String
    let dx: String?
    let ram_min_gb: Int?
    let launch_options: String?
    let notes: String?
    let notes_fr: String?
    let settings: [String: TierSettings]?
    let fixes: [GameFix]?

    var localizedNotes: String? {
        let n = L.fr ? (notes_fr ?? notes) : notes
        return (n?.isEmpty ?? true) ? nil : n
    }

    static func == (lhs: GameEntry, rhs: GameEntry) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

struct GamesFile: Codable {
    let games: [GameEntry]
}

struct DoctorReport {
    let profile: HardwareProfile
    let swapUsedGB: Double
    let swapTotalGB: Double
    let diskFreeGB: Double
    let wrapperInstalled: Bool
    let engineVersion: String?
    let activeBackend: String
    let sessionAlive: Bool
    let steamRunning: Bool

    var swapSaturated: Bool { swapTotalGB > 0 && swapUsedGB / swapTotalGB > 0.75 }
}

// MARK: - Native engine (no external runtime needed)

enum Engine {
    static let wrapperPath = NSHomeDirectory() + "/Applications/Sikarugir/Steam.app"
    static let cachePath = NSHomeDirectory() + "/Library/Caches/macplay"

    static let templateURL = "https://github.com/Sikarugir-App/Wrapper/releases/download/v1.0/Template-1.0.11.tar.xz"
    static let engineURL = "https://github.com/Sikarugir-App/Engines/releases/download/v1.0/WS12WineSikarugir10.0_6.tar.xz"
    static let winetricksURL = "https://raw.githubusercontent.com/Sikarugir-App/winetricks/master/src/winetricks"
    static let steamSetupURL = "https://cdn.cloudflare.steamstatic.com/client/installer/SteamSetup.exe"
    static let steamFlags = "-allosarches -cef-force-32bit -cef-in-process-gpu -cef-disable-sandbox"

    static let backendKeys = ["d3dmetal": "D3DMETAL", "dxmt": "DXMT", "dxvk": "DXVK"]

    // MARK: shell helper (system binaries only — present on every Mac)

    @discardableResult
    static func sh(_ path: String, _ args: [String], env extraEnv: [String: String] = [:]) -> (code: Int32, out: String) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: path)
        p.arguments = args
        if !extraEnv.isEmpty {
            p.environment = ProcessInfo.processInfo.environment.merging(extraEnv) { _, new in new }
        }
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = pipe
        do { try p.run() } catch { return (-1, "\(error.localizedDescription)") }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        return (p.terminationStatus, String(data: data, encoding: .utf8) ?? "")
    }

    // MARK: data

    static func loadGames() -> [GameEntry] {
        // Bundled DB first; MACPLAY_DATA=<repo>/data as a dev override when
        // running the bare executable outside an .app bundle.
        let candidates = [
            Bundle.main.resourceURL?.appendingPathComponent("engine/data/games.json"),
            ProcessInfo.processInfo.environment["MACPLAY_DATA"]
                .map { URL(fileURLWithPath: $0).appendingPathComponent("games.json") },
        ].compactMap { $0 }
        for url in candidates {
            if let data = try? Data(contentsOf: url),
               let file = try? JSONDecoder().decode(GamesFile.self, from: data) {
                return file.games
            }
        }
        return []
    }

    // MARK: detect

    static func detect() -> HardwareProfile {
        let chip = sh("/usr/sbin/sysctl", ["-n", "machdep.cpu.brand_string"]).out
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let ramBytes = Int64(sh("/usr/sbin/sysctl", ["-n", "hw.memsize"]).out
            .trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0

        var tier = "base"
        for t in ["Pro", "Max", "Ultra"] where chip.hasSuffix(t) { tier = t.lowercased() }

        var gpuCores: Int? = nil
        let disp = sh("/usr/sbin/system_profiler", ["SPDisplaysDataType", "-json"]).out
        if let data = disp.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let displays = json["SPDisplaysDataType"] as? [[String: Any]],
           let first = displays.first {
            if let s = first["sppci_cores"] as? String { gpuCores = Int(s) }
            if let i = first["sppci_cores"] as? Int { gpuCores = i }
        }

        let v = ProcessInfo.processInfo.operatingSystemVersion
        let rosetta = FileManager.default.fileExists(atPath: "/Library/Apple/usr/libexec/oah")
            || sh("/usr/bin/pgrep", ["-q", "oahd"]).code == 0

        return HardwareProfile(
            chip: chip,
            tier: tier,
            ramGB: Int((Double(ramBytes) / 1_073_741_824.0).rounded()),
            gpuCores: gpuCores,
            macosVersion: "\(v.majorVersion).\(v.minorVersion)",
            rosetta: rosetta,
            appleSilicon: chip.hasPrefix("Apple")
        )
    }

    // MARK: doctor

    static func doctor() -> DoctorReport {
        let profile = detect()

        var swapUsed = 0.0, swapTotal = 0.0
        let swap = sh("/usr/sbin/sysctl", ["-n", "vm.swapusage"]).out
        if let m = swap.range(of: #"total = ([\d.]+)M"#, options: .regularExpression) {
            swapTotal = (Double(swap[m].dropFirst(8).dropLast(1)) ?? 0) / 1024
        }
        if let m = swap.range(of: #"used = ([\d.]+)M"#, options: .regularExpression) {
            swapUsed = (Double(swap[m].dropFirst(7).dropLast(1)) ?? 0) / 1024
        }

        var diskFree = 0.0
        if let attrs = try? FileManager.default.attributesOfFileSystem(forPath: "/"),
           let free = attrs[.systemFreeSize] as? Int64 {
            diskFree = Double(free) / 1_073_741_824.0
        }

        let installed = wrapperInstalled
        var engineVersion: String? = nil
        var backend = "WineD3D"
        if installed {
            engineVersion = (try? String(contentsOfFile: wrapperPath + "/Contents/SharedSupport/wine/version", encoding: .utf8))?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if let plist = readWrapperPlist() {
                let active = backendKeys.values.filter { (plist[$0] as? Int) == 1 || (plist[$0] as? Bool) == true }
                if !active.isEmpty { backend = active.joined(separator: ", ") }
            }
        }
        let alive = sh("/usr/bin/pgrep", ["-f", wrapperPath + ".*wineserver"]).code == 0

        return DoctorReport(
            profile: profile,
            swapUsedGB: swapUsed, swapTotalGB: swapTotal,
            diskFreeGB: diskFree,
            wrapperInstalled: installed,
            engineVersion: engineVersion,
            activeBackend: backend,
            sessionAlive: alive,
            steamRunning: installed && steamUIAlive
        )
    }

    static var wrapperInstalled: Bool {
        FileManager.default.fileExists(atPath: wrapperPath + "/Contents/Info.plist")
    }

    // MARK: wrapper plist

    static func readWrapperPlist() -> [String: Any]? {
        guard let data = FileManager.default.contents(atPath: wrapperPath + "/Contents/Info.plist") else { return nil }
        return (try? PropertyListSerialization.propertyList(from: data, format: nil)) as? [String: Any]
    }

    static func writeWrapperPlist(_ plist: [String: Any]) throws {
        let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
        try data.write(to: URL(fileURLWithPath: wrapperPath + "/Contents/Info.plist"))
    }

    /// Set the graphics backend toggles for a game. Returns the applied key.
    static func applyBackend(_ backend: String) throws -> String {
        guard var plist = readWrapperPlist() else {
            throw NSError(domain: "macplay", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: L.t("Wrapper not found — install Steam first.",
                                                                    "Wrapper introuvable — installe Steam d'abord.")])
        }
        for key in backendKeys.values { plist[key] = 0 }
        if let key = backendKeys[backend] { plist[key] = 1 }
        plist["MOLTENVKCX"] = 1
        try writeWrapperPlist(plist)
        return backendKeys[backend] ?? "WineD3D"
    }

    // MARK: process helpers

    static var prefixPath: String { wrapperPath + "/Contents/SharedSupport/prefix" }
    static var winePath: String { wrapperPath + "/Contents/SharedSupport/wine/bin/wine" }

    static func processAlive(_ pattern: String) -> Bool {
        sh("/usr/bin/pgrep", ["-f", pattern]).code == 0
    }

    /// The Steam UI (CEF helper) only runs when the client is actually up.
    static var steamUIAlive: Bool { processAlive("steamwebhelper") }

    /// True while Steam is downloading/installing something: the `downloading`
    /// folder holds partial data, or a manifest is in a non-"fully installed"
    /// (StateFlags 4) state. Restarting Steam mid-download can make it discard
    /// the partial, so callers must never kill the session while this is true.
    static var downloadInProgress: Bool {
        let steamapps = prefixPath + "/drive_c/Program Files (x86)/Steam/steamapps"
        let dl = steamapps + "/downloading"
        if let items = try? FileManager.default.contentsOfDirectory(atPath: dl),
           items.contains(where: { $0 != ".DS_Store" }) {
            return true
        }
        for f in (try? FileManager.default.contentsOfDirectory(atPath: steamapps)) ?? []
        where f.hasPrefix("appmanifest_") && f.hasSuffix(".acf") {
            if let text = try? String(contentsOfFile: steamapps + "/" + f, encoding: .utf8),
               let m = text.range(of: #""StateFlags"\s*"(\d+)""#, options: .regularExpression),
               let flags = Int(text[m].components(separatedBy: "\"").dropLast().last ?? ""),
               flags != 4 {  // 4 = fully installed and idle
                return true
            }
        }
        return false
    }

    /// Backend currently active in the wrapper ("d3dmetal", "dxmt", "dxvk" or "wined3d").
    static var activeBackend: String {
        guard let plist = readWrapperPlist() else { return "wined3d" }
        for (name, key) in backendKeys where (plist[key] as? Int) == 1 || (plist[key] as? Bool) == true {
            return name
        }
        return "wined3d"
    }

    // MARK: long-running actions (emit log lines, then completion code)

    /// Boot the wrapper's Steam with extra command-line arguments.
    /// Under Wine, a second steam.exe does NOT forward commands to the running
    /// instance (verified), so the reliable path is: temporarily append the
    /// arguments to the wrapper's launch flags, (re)start Steam through its own
    /// launcher (which sets up the full backend env), then restore the flags.
    static func bootSteam(extraArgs: String, emit: (String) -> Void) -> Bool {
        guard wrapperInstalled, var plist = readWrapperPlist() else {
            emit(L.t("Steam is not installed.", "Steam n'est pas installé."))
            return false
        }
        let originalFlags = (plist["Program Flags"] as? String) ?? steamFlags

        // Never kill Steam mid-download — it would discard the partial data.
        if steamUIAlive && downloadInProgress {
            emit(L.t("A download is in progress in Steam — not restarting it. Try again once the download is finished.",
                     "Un téléchargement est en cours dans Steam — je ne le redémarre pas. Réessaie une fois le téléchargement terminé."))
            return false
        }

        if steamUIAlive {
            emit(L.t("Restarting Steam…", "Redémarrage de Steam…"))
            sh(wrapperPath + "/Contents/MacOS/wineskinlauncher", ["WSS-wineserverkill"])
            Thread.sleep(forTimeInterval: 3)
        } else {
            emit(L.t("Starting Steam…", "Démarrage de Steam…"))
        }

        plist["Program Flags"] = originalFlags + " " + extraArgs
        do { try writeWrapperPlist(plist) } catch {
            emit(error.localizedDescription)
            return false
        }

        func restoreFlags() {
            if var p = readWrapperPlist() {
                p["Program Flags"] = originalFlags
                try? writeWrapperPlist(p)
            }
        }

        sh("/usr/bin/open", [wrapperPath])

        // Restore the flags only once steam.exe is visibly running WITH our
        // extra args — restoring earlier races the launcher's plist read
        // (cold boots can take minutes).
        let argPattern = extraArgs.map { $0.isLetter || $0.isNumber ? String($0) : "." }.joined()
        var argsConsumed = false
        var waited = 0
        while waited < 240 {
            if processAlive(argPattern) { argsConsumed = true; break }
            Thread.sleep(forTimeInterval: 3)
            waited += 3
        }
        restoreFlags()
        guard argsConsumed else {
            emit(L.t("Steam did not start in time.", "Steam n'a pas démarré à temps."))
            return false
        }

        waited = 0
        while !steamUIAlive && waited < 120 {
            Thread.sleep(forTimeInterval: 3)
            waited += 3
        }
        guard steamUIAlive else {
            emit(L.t("Steam did not start.", "Steam n'a pas démarré."))
            return false
        }
        return true
    }

    static func launchGameSync(appid: String, emit: (String) -> Void) -> Bool {
        guard bootSteam(extraArgs: "-applaunch " + appid, emit: emit) else { return false }
        emit(L.t("Steam is up — the game is launching (first launch can take a while: updates, shaders)…",
                 "Steam est lancé — le jeu démarre (le premier lancement peut être long : mises à jour, shaders)…"))
        return true
    }

    /// Trigger a game install.
    /// Wine can't inject a steam:// command into an already-running Steam
    /// (verified: neither a second steam.exe nor `wine start` reaches it), and
    /// restarting Steam would abort any download in progress. So:
    ///   - Steam down  -> boot it with steam://install (opens the confirm dialog)
    ///   - Steam up     -> bring it to front and let the user add the game there
    ///                     (this is how Steam queues multiple downloads anyway)
    static func installGame(appid: String, gameTitle: String,
                            emit: @escaping (String) -> Void, done: @escaping (Int32) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            if steamUIAlive {
                sh("/usr/bin/open", [wrapperPath])  // focus the Steam window
                emit(L.t("Steam is already open. In its window, go to your Library, find “\(gameTitle)” and click Install — it will queue up next to any current download.",
                         "Steam est déjà ouvert. Dans sa fenêtre, va dans ta Bibliothèque, cherche « \(gameTitle) » et clique Installer — il se mettra en file d'attente à côté du téléchargement en cours."))
                done(0)
                return
            }
            let ok = bootSteam(extraArgs: "steam://install/" + appid, emit: emit)
            if ok {
                emit(L.t("Steam is showing the install window — confirm it there. Once installed, the game appears in “My games”.",
                         "Steam affiche la fenêtre d'installation — confirme là-bas. Une fois installé, le jeu apparaît dans « Mes jeux »."))
            }
            done(ok ? 0 : 1)
        }
    }

    static func uninstallSteam(emit: @escaping (String) -> Void, done: @escaping (Int32) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard wrapperInstalled else { done(0); return }
            emit(L.t("Stopping the Wine session…", "Arrêt de la session Wine…"))
            sh(wrapperPath + "/Contents/MacOS/wineskinlauncher", ["WSS-wineserverkill"])
            Thread.sleep(forTimeInterval: 3)
            emit(L.t("Deleting the wrapper and everything inside…",
                     "Suppression du wrapper et de tout son contenu…"))
            try? FileManager.default.removeItem(atPath: wrapperPath)
            let gone = !wrapperInstalled
            emit(gone ? L.t("Steam is uninstalled.", "Steam est désinstallé.")
                      : L.t("Could not delete the wrapper.", "Impossible de supprimer le wrapper."))
            done(gone ? 0 : 1)
        }
    }

    static func reinstallSteam(emit: @escaping (String) -> Void, done: @escaping (Int32) -> Void) {
        uninstallSteam(emit: emit) { code in
            guard code == 0 else { done(code); return }
            setupSteam(emit: emit, done: done)
        }
    }

    static func restart(emit: @escaping (String) -> Void, done: @escaping (Int32) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            emit(L.t("Stopping the Wine session…", "Arrêt de la session Wine…"))
            sh(wrapperPath + "/Contents/MacOS/wineskinlauncher", ["WSS-wineserverkill"])
            Thread.sleep(forTimeInterval: 3)
            emit(L.t("Relaunching Steam…", "Relance de Steam…"))
            sh("/usr/bin/open", [wrapperPath])
            done(0)
        }
    }

    static func setupSteam(emit: @escaping (String) -> Void, done: @escaping (Int32) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try runSetup(emit: emit)
                done(0)
            } catch {
                emit("✗ \(error.localizedDescription)")
                done(1)
            }
        }
    }

    private static func fail(_ message: String) -> NSError {
        NSError(domain: "macplay", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    private static func runSetup(emit: (String) -> Void) throws {
        let fm = FileManager.default
        guard !wrapperInstalled else {
            throw fail(L.t("Steam is already installed.", "Steam est déjà installé."))
        }
        try fm.createDirectory(atPath: cachePath, withIntermediateDirectories: true)
        try fm.createDirectory(atPath: (wrapperPath as NSString).deletingLastPathComponent,
                               withIntermediateDirectories: true)

        // 1. downloads (curl ships with macOS)
        let downloads = [
            ("Template.tar.xz", templateURL), ("Engine.tar.xz", engineURL),
            ("winetricks", winetricksURL), ("SteamSetup.exe", steamSetupURL),
        ]
        for (name, url) in downloads {
            let dest = cachePath + "/" + name
            if fm.fileExists(atPath: dest) {
                emit(L.t("Cached: \(name)", "En cache : \(name)"))
                continue
            }
            emit(L.t("Downloading \(name)…", "Téléchargement de \(name)…"))
            let r = sh("/usr/bin/curl", ["-sL", "--fail", "-o", dest + ".part", url])
            guard r.code == 0 else { throw fail(L.t("Download failed: \(name)", "Échec du téléchargement : \(name)")) }
            try fm.moveItem(atPath: dest + ".part", toPath: dest)
        }
        sh("/bin/chmod", ["+x", cachePath + "/winetricks"])

        // 2. assemble wrapper
        emit(L.t("Assembling the wrapper…", "Assemblage du wrapper…"))
        let work = cachePath + "/work"
        try? fm.removeItem(atPath: work)
        try fm.createDirectory(atPath: work, withIntermediateDirectories: true)
        guard sh("/usr/bin/tar", ["-xf", cachePath + "/Template.tar.xz", "-C", work]).code == 0
        else { throw fail("tar template") }
        guard let appName = try fm.contentsOfDirectory(atPath: work).first(where: { $0.hasSuffix(".app") })
        else { throw fail("template .app not found") }
        try fm.moveItem(atPath: work + "/" + appName, toPath: wrapperPath)

        guard sh("/usr/bin/tar", ["-xf", cachePath + "/Engine.tar.xz", "-C", work]).code == 0
        else { throw fail("tar engine") }
        let wineDst = wrapperPath + "/Contents/SharedSupport/wine"
        try? fm.removeItem(atPath: wineDst)
        try fm.moveItem(atPath: work + "/wswine.bundle", toPath: wineDst)

        // dylib fix: SIP strips DYLD_FALLBACK_LIBRARY_PATH outside the launcher,
        // so wine's @rpath lookups need the wrapper Frameworks visible from wine/lib
        let fwDir = wrapperPath + "/Contents/Frameworks"
        for name in (try? fm.contentsOfDirectory(atPath: fwDir)) ?? [] where name.hasSuffix(".dylib") {
            let link = wineDst + "/lib/" + name
            if !fm.fileExists(atPath: link) {
                try? fm.createSymbolicLink(atPath: link, withDestinationPath: "../../../Frameworks/" + name)
            }
        }
        sh("/usr/bin/xattr", ["-drs", "com.apple.quarantine", wrapperPath])

        // 3. wine prefix — the launcher idles in its GUI event loop after the work
        // is done, so poll for completion and terminate it ourselves
        emit(L.t("Creating the Wine prefix (1-2 min)…", "Création du prefix Wine (1-2 min)…"))
        let prefix = wrapperPath + "/Contents/SharedSupport/prefix"
        try runLauncherStep(arg: "WSS-wineprefixcreate", doneCheck: {
            fm.fileExists(atPath: prefix + "/system.reg")
                && fm.fileExists(atPath: prefix + "/user.reg")
                && sh("/usr/bin/pgrep", ["-f", wrapperPath + ".*wineserver"]).code != 0
        })

        // 4. Steam via winetricks (corefonts + known workarounds)
        emit(L.t("Installing Steam (several minutes)…", "Installation de Steam (plusieurs minutes)…"))
        let wtCache = NSHomeDirectory() + "/.cache/winetricks/steam"
        try fm.createDirectory(atPath: wtCache, withIntermediateDirectories: true)
        if !fm.fileExists(atPath: wtCache + "/SteamSetup.exe") {
            try fm.copyItem(atPath: cachePath + "/SteamSetup.exe", toPath: wtCache + "/SteamSetup.exe")
        }
        let env = [
            "WINEPREFIX": prefix,
            "WINE": wineDst + "/bin/wine",
            "WINESERVER": wineDst + "/bin/wineserver",
            "PATH": wineDst + "/bin:" + wrapperPath + "/Contents/Configure.app/Contents/Resources:"
                + (ProcessInfo.processInfo.environment["PATH"] ?? "/usr/bin:/bin"),
        ]
        let wt = sh("/bin/sh", [cachePath + "/winetricks", "-q", "steam"], env: env)
        guard wt.code == 0,
              fm.fileExists(atPath: prefix + "/drive_c/Program Files (x86)/Steam/Steam.exe")
        else { throw fail(L.t("Steam installation failed.", "L'installation de Steam a échoué.")) }

        // 5. configure
        emit(L.t("Configuring…", "Configuration…"))
        guard var plist = readWrapperPlist() else { throw fail("wrapper plist unreadable") }
        plist["CFBundleName"] = "Steam"
        plist["CFBundleIdentifier"] = "com.macplay.steam"
        plist["Program Name and Path"] = "/Program Files (x86)/Steam/Steam.exe"
        plist["Program Flags"] = steamFlags
        plist["D3DMETAL"] = 1
        plist["MOLTENVKCX"] = 1
        try writeWrapperPlist(plist)

        emit(L.t("Launching Steam — log in and install your games!",
                 "Lancement de Steam — connecte-toi et installe tes jeux !"))
        sh("/usr/bin/open", [wrapperPath])
    }

    private static func runLauncherStep(arg: String, doneCheck: () -> Bool, timeout: TimeInterval = 600) throws {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: wrapperPath + "/Contents/MacOS/wineskinlauncher")
        p.arguments = [arg]
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        try p.run()

        let start = Date()
        var confirmed = 0
        while Date().timeIntervalSince(start) < timeout {
            if !p.isRunning { return }
            if doneCheck() {
                confirmed += 1
                if confirmed >= 3 {  // stable across ~6s: the wine work is done
                    p.terminate()
                    return
                }
            } else {
                confirmed = 0
            }
            Thread.sleep(forTimeInterval: 2)
        }
        p.terminate()
        throw fail("wineskinlauncher \(arg): timeout")
    }
}
