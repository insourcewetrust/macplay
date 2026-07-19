import SwiftUI

private let statusOrder = ["gold", "silver", "bronze", "native", "blocked", "borked"]

struct GamesView: View {
    @State private var games: [GameEntry] = []
    @State private var selected: GameEntry?
    @State private var profile: HardwareProfile?
    @State private var search = ""
    @StateObject private var runner = ActionRunner()

    private var filtered: [GameEntry] {
        search.isEmpty ? games : games.filter { $0.title.localizedCaseInsensitiveContains(search) }
    }

    private var sections: [(status: String, items: [GameEntry])] {
        statusOrder.compactMap { status in
            let items = filtered.filter { $0.status == status }
            return items.isEmpty ? nil : (status, items.sorted { $0.title < $1.title })
        }
    }

    var body: some View {
        HStack(spacing: 0) {
            VStack(spacing: 0) {
                TextField(L.t("Search a game…", "Chercher un jeu…"), text: $search)
                    .textFieldStyle(.roundedBorder)
                    .padding(10)
                List(selection: $selected) {
                    ForEach(sections, id: \.status) { section in
                        Section(statusLabel(section.status)) {
                            ForEach(section.items) { game in
                                HStack {
                                    Circle()
                                        .fill(statusColor(game.status))
                                        .frame(width: 8, height: 8)
                                    Text(game.title).lineLimit(1)
                                }
                                .tag(game)
                            }
                        }
                    }
                }
            }
            .frame(width: 300)

            Divider()

            if let game = selected {
                GameDetail(game: game, profile: profile, runner: runner)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "gamecontroller")
                        .font(.system(size: 40, weight: .thin))
                        .foregroundStyle(.tertiary)
                    Text(L.t("Pick a game to see its recommended setup",
                             "Choisis un jeu pour voir sa configuration recommandée"))
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task {
            games = Engine.loadGames()
            profile = await Task.detached { Engine.detect() }.value
        }
    }
}

func statusColor(_ status: String) -> Color {
    switch status {
    case "gold": return .yellow
    case "silver": return .gray
    case "bronze": return .orange
    case "native": return .green
    default: return .red
    }
}

func statusLabel(_ status: String) -> String {
    switch status {
    case "gold": return L.t("Runs great", "Excellent")
    case "silver": return L.t("Playable", "Jouable")
    case "bronze": return L.t("Rough", "Limite")
    case "native": return L.t("Native on Mac", "Natif Mac")
    case "blocked": return L.t("Blocked (anticheat)", "Bloqué (anticheat)")
    default: return L.t("Not working", "Ne marche pas")
    }
}

struct GameDetail: View {
    let game: GameEntry
    let profile: HardwareProfile?
    @ObservedObject var runner: ActionRunner

    private var tierSettings: TierSettings? {
        guard let settings = game.settings, !settings.isEmpty else { return nil }
        let tier = profile?.tier ?? "default"
        let order = ["ultra", "max", "pro", "base"]
        if let s = settings[tier] { return s }
        if let idx = order.firstIndex(of: tier) {
            for t in order[idx...] where settings[t] != nil { return settings[t] }
        }
        return settings["default"]
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .firstTextBaseline) {
                    Text(game.title).font(.title.bold())
                    Spacer()
                    Text(statusLabel(game.status))
                        .font(.caption.bold())
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(statusColor(game.status).opacity(0.2), in: Capsule())
                }

                if game.status == "blocked" {
                    Label(game.localizedNotes
                            ?? L.t("Incompatible anticheat: this game cannot run through Wine.",
                                   "Anticheat incompatible : ce jeu ne peut pas tourner via Wine."),
                          systemImage: "xmark.shield")
                        .foregroundStyle(.red)
                } else if game.status == "native" {
                    Label(L.t("A native Mac version exists — play it on your regular macOS Steam.",
                              "Version Mac native disponible — joue-la sur ton Steam macOS normal."),
                          systemImage: "checkmark.seal")
                        .foregroundStyle(.green)
                    if let notes = game.localizedNotes {
                        Text(notes).font(.callout).foregroundStyle(.secondary)
                    }
                } else if game.status == "borked" {
                    Label(game.localizedNotes ?? L.t("Does not work through the wrapper.",
                                                     "Ne fonctionne pas via le wrapper."),
                          systemImage: "xmark.circle")
                        .foregroundStyle(.red)
                } else {
                    if let est = Perf.estimate(profile: profile, game: game) {
                        Label {
                            Text(L.t("On your \(profile?.chip ?? "Mac") (\(profile?.gpuCores ?? 0) GPU cores): ~\(est.fpsRange) fps expected — \(est.hint). Estimate, not a promise.",
                                     "Sur ta \(profile?.chip ?? "machine") (\(profile?.gpuCores ?? 0) cœurs GPU) : ~\(est.fpsRange) fps attendus — \(est.hint). Estimation, pas une promesse."))
                        } icon: {
                            Image(systemName: "gauge.with.dots.needle.67percent")
                        }
                        .font(.callout)
                        .foregroundStyle(.secondary)
                    }

                    GroupBox(L.t("Setup for your Mac", "Configuration pour ta machine")
                             + (profile.map { " (\($0.chip))" } ?? "")) {
                        VStack(alignment: .leading, spacing: 8) {
                            DetailRow(label: L.t("Graphics backend", "Backend graphique"),
                                      value: game.backend.uppercased())
                            if let dx = game.dx, !dx.isEmpty {
                                DetailRow(label: "API", value: dx.uppercased())
                            }
                            if let s = tierSettings {
                                DetailRow(label: L.t("Preset", "Preset"), value: s.preset)
                                DetailRow(label: "Upscaling", value: s.upscaling)
                                if let extra = s.extra, !extra.isEmpty {
                                    DetailRow(label: L.t("Also set", "À régler"), value: extra)
                                }
                            }
                            if let lo = game.launch_options, !lo.isEmpty {
                                DetailRow(label: L.t("Launch options", "Options de lancement"), value: lo, mono: true)
                            }
                            if let ram = game.ram_min_gb, let p = profile, p.ramGB <= ram {
                                Label(L.t("Your Mac is at the RAM minimum (\(ram) GB): close browsers and heavy apps before playing.",
                                          "Ta machine est au minimum RAM (\(ram) Go) : ferme navigateurs et grosses apps avant de jouer."),
                                      systemImage: "memorychip")
                                    .font(.callout)
                                    .foregroundStyle(.orange)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(4)
                    }

                    if let appid = game.steam_appid, Engine.wrapperInstalled {
                        HStack {
                            Button {
                                let title = game.title
                                runner.start(L.t("Install \(title)", "Installation de \(title)")) { emit, doneCb in
                                    Engine.installGame(appid: String(appid), gameTitle: title, emit: emit, done: doneCb)
                                }
                            } label: {
                                Label(L.t("Install via Steam", "Installer via Steam"), systemImage: "square.and.arrow.down")
                            }
                            .disabled(runner.running)
                            Text(L.t("Opens the Steam install window (game must be owned or free).",
                                     "Ouvre la fenêtre d'installation Steam (jeu possédé ou gratuit)."))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }

                    HStack {
                        Button(L.t("Apply and restart Steam", "Appliquer et relancer Steam")) {
                            let backend = game.backend
                            runner.start(L.t("Setting \(backend.uppercased()) for \(game.title)",
                                             "Configuration \(backend.uppercased()) pour \(game.title)")) { emit, doneCb in
                                do {
                                    let applied = try Engine.applyBackend(backend)
                                    emit(L.t("Backend set to \(applied).", "Backend réglé sur \(applied)."))
                                    Engine.restart(emit: emit, done: doneCb)
                                } catch {
                                    emit(error.localizedDescription)
                                    doneCb(1)
                                }
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(runner.running)
                        Text(L.t("Sets the wrapper backend, then restarts the Wine session.",
                                 "Règle le backend du wrapper puis redémarre la session Wine."))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    if let fixes = game.fixes, !fixes.isEmpty {
                        GroupBox(L.t("Known issues", "Problèmes connus")) {
                            VStack(alignment: .leading, spacing: 10) {
                                ForEach(fixes, id: \.symptom) { f in
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(f.localizedSymptom).font(.callout.weight(.medium))
                                        Text(f.localizedFix).font(.callout).foregroundStyle(.secondary)
                                    }
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(4)
                        }
                    }

                    if let notes = game.localizedNotes {
                        Text(notes).font(.callout).foregroundStyle(.secondary)
                    }
                }

                if !runner.log.isEmpty {
                    LogPanel(runner: runner)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: 720, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
        }
    }
}

struct DetailRow: View {
    let label: String
    let value: String
    var mono = false

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).foregroundStyle(.secondary).frame(width: 160, alignment: .leading)
            Text(value)
                .font(mono ? .system(.body, design: .monospaced) : .body)
                .textSelection(.enabled)
        }
        .font(.callout)
    }
}
