import Foundation

struct InstalledGame: Identifiable, Hashable {
    let appid: String
    let name: String
    let installdir: String
    let sizeBytes: Int64
    var id: String { appid }

    var sizeGB: Double { Double(sizeBytes) / 1_073_741_824.0 }

    /// pgrep -f pattern matching the game's processes inside the wrapper
    /// (windows paths contain "steamapps\common\<installdir>\"; non-alphanumeric
    /// chars are wildcarded so backslashes and spaces both match).
    var processPattern: String {
        let dir = installdir.map { $0.isLetter || $0.isNumber ? String($0) : "." }.joined()
        return "steamapps.common." + dir
    }
}

enum SteamLibrary {
    static var steamappsPath: String {
        Engine.wrapperPath + "/Contents/SharedSupport/prefix/drive_c/Program Files (x86)/Steam/steamapps"
    }

    /// Games installed inside the wrapper, parsed from Valve's appmanifest ACF files.
    static func installedGames() -> [InstalledGame] {
        let fm = FileManager.default
        guard let files = try? fm.contentsOfDirectory(atPath: steamappsPath) else { return [] }

        var out: [InstalledGame] = []
        for f in files where f.hasPrefix("appmanifest_") && f.hasSuffix(".acf") {
            guard let text = try? String(contentsOfFile: steamappsPath + "/" + f, encoding: .utf8) else { continue }
            guard let appid = acfValue(text, "appid"),
                  let name = acfValue(text, "name"),
                  appid != "228980"  // Steamworks Common Redistributables
            else { continue }
            let size = Int64(acfValue(text, "SizeOnDisk") ?? "") ?? 0
            out.append(InstalledGame(appid: appid, name: name,
                                     installdir: acfValue(text, "installdir") ?? name,
                                     sizeBytes: size))
        }
        return out.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    /// Extract `"key"  "value"` from Valve's KeyValues text format.
    private static func acfValue(_ text: String, _ key: String) -> String? {
        guard let keyRange = text.range(of: "\"\(key)\"") else { return nil }
        let rest = text[keyRange.upperBound...]
        guard let q1 = rest.firstIndex(of: "\"") else { return nil }
        let afterQ1 = rest.index(after: q1)
        guard let q2 = rest[afterQ1...].firstIndex(of: "\"") else { return nil }
        return String(rest[afterQ1..<q2])
    }
}

// MARK: - Hub client (community ratings)

struct ReportStats: Codable {
    let avg_rating: Double
    let report_count: Int
}

enum Hub {
    /// Ratings backend URL — override with: defaults write com.macplay.app hubURL <url>
    static var baseURL: String {
        UserDefaults.standard.string(forKey: "hubURL") ?? "https://macgamers-hub.srv1418612.hstgr.cloud"
    }

    /// Anonymous per-install id: lets a user update their own report, nothing more.
    static var installID: String {
        if let id = UserDefaults.standard.string(forKey: "installID") { return id }
        let id = UUID().uuidString
        UserDefaults.standard.set(id, forKey: "installID")
        return id
    }

    static func fetchStats(appids: [String]) async -> [String: ReportStats] {
        guard !appids.isEmpty,
              let url = URL(string: baseURL + "/api/compat-reports?appids=" + appids.joined(separator: ","))
        else { return [:] }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            return (try? JSONDecoder().decode([String: ReportStats].self, from: data)) ?? [:]
        } catch {
            return [:]
        }
    }

    static func submitReport(game: InstalledGame, rating: Int, comment: String,
                             profile: HardwareProfile?, backend: String) async throws -> ReportStats? {
        guard let url = URL(string: baseURL + "/api/compat-reports") else { return nil }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let payload: [String: Any] = [
            "install_id": installID,
            "steam_appid": game.appid,
            "game_title": game.name,
            "rating": rating,
            "comment": comment,
            "chip": profile?.chip ?? "",
            "chip_tier": profile?.tier ?? "",
            "ram_gb": profile?.ramGB ?? 0,
            "macos": profile?.macosVersion ?? "",
            "backend": backend,
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw NSError(domain: "macplay", code: 2, userInfo: [
                NSLocalizedDescriptionKey: L.t("The server refused the report.", "Le serveur a refusé l'avis."),
            ])
        }
        struct Reply: Codable { let ok: Bool; let stats: ReportStats? }
        return (try? JSONDecoder().decode(Reply.self, from: data))?.stats
    }
}
