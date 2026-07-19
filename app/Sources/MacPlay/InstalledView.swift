import SwiftUI

struct InstalledView: View {
    @State private var installed: [InstalledGame] = []
    @State private var stats: [String: ReportStats] = [:]
    @State private var selected: InstalledGame?
    @State private var profile: HardwareProfile?
    @State private var knownGames: [String: GameEntry] = [:]

    var body: some View {
        HStack(spacing: 0) {
            List(installed, selection: $selected) { game in
                VStack(alignment: .leading, spacing: 2) {
                    Text(game.name).lineLimit(1)
                    HStack(spacing: 6) {
                        if game.sizeGB > 0.05 {
                            Text(String(format: "%.1f \(L.t("GB", "Go"))", game.sizeGB))
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                        if let s = stats[game.appid] {
                            HStack(spacing: 2) {
                                Image(systemName: "star.fill").font(.system(size: 8)).foregroundStyle(.yellow)
                                Text(String(format: "%.1f (%d)", s.avg_rating, s.report_count))
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .tag(game)
            }
            .frame(width: 290)
            .overlay {
                if installed.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "square.and.arrow.down")
                            .font(.system(size: 32, weight: .thin))
                            .foregroundStyle(.tertiary)
                        Text(L.t("No games installed in the wrapper yet.\nInstall one from Steam first.",
                                 "Aucun jeu installé dans le wrapper.\nInstalle-en un depuis Steam d'abord."))
                            .multilineTextAlignment(.center)
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Divider()

            if let game = selected {
                InstalledDetail(game: game,
                                known: knownGames[game.appid],
                                stats: stats[game.appid],
                                profile: profile) { newStats in
                    if let newStats { stats[game.appid] = newStats }
                }
                .id(game.appid)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "play.circle")
                        .font(.system(size: 40, weight: .thin))
                        .foregroundStyle(.tertiary)
                    Text(L.t("Pick a game: play it, tune its engine, rate it",
                             "Choisis un jeu : joue, règle son moteur, note-le"))
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task {
            installed = SteamLibrary.installedGames()
            knownGames = Dictionary(uniqueKeysWithValues:
                Engine.loadGames().compactMap { g in g.steam_appid.map { (String($0), g) } })
            profile = await Task.detached { Engine.detect() }.value
            stats = await Hub.fetchStats(appids: installed.map(\.appid))
        }
    }
}

private let backendChoices: [(id: String, label: String)] = [
    ("d3dmetal", "D3DMetal"),
    ("dxmt", "DXMT"),
    ("dxvk", "DXVK"),
    ("wined3d", "WineD3D"),
]

struct InstalledDetail: View {
    let game: InstalledGame
    let known: GameEntry?
    let stats: ReportStats?
    let profile: HardwareProfile?
    let onSubmitted: (ReportStats?) -> Void

    @StateObject private var session = GameSession()
    @StateObject private var runner = ActionRunner()
    @State private var chosenBackend = Engine.activeBackend
    @State private var rating = 0
    @State private var comment = ""
    @State private var submitting = false
    @State private var feedback: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Title + play
                HStack(alignment: .firstTextBaseline) {
                    Text(game.name).font(.title.bold())
                    Spacer()
                    Button {
                        session.play(game)
                    } label: {
                        Label(L.t("Play", "Jouer"), systemImage: "play.fill")
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(session.phase == .launching || session.phase == .waitingForGame
                              || session.phase == .running || runner.running)
                }

                sessionStatus

                if let s = stats {
                    HStack(spacing: 4) {
                        Image(systemName: "star.fill").foregroundStyle(.yellow)
                        Text(String(format: "%.1f", s.avg_rating)).font(.headline)
                        Text(L.t("community average (\(s.report_count) reports)",
                                 "moyenne communauté (\(s.report_count) avis)"))
                            .foregroundStyle(.secondary)
                    }
                    .font(.callout)
                }

                // Model-specific expectation
                if let known, let est = Perf.estimate(profile: profile, game: known) {
                    Label {
                        Text(L.t("On your \(profile?.chip ?? "Mac") (\(profile?.gpuCores ?? 0) GPU cores): ~\(est.fpsRange) fps expected — \(est.hint). Estimate, not a promise.",
                                 "Sur ta \(profile?.chip ?? "machine") (\(profile?.gpuCores ?? 0) cœurs GPU) : ~\(est.fpsRange) fps attendus — \(est.hint). Estimation, pas une promesse."))
                    } icon: {
                        Image(systemName: "gauge.with.dots.needle.67percent")
                    }
                    .font(.callout)
                    .foregroundStyle(.secondary)
                }

                // Engine choice — the escape hatch for unlisted games,
                // and the fix path after a crash
                GroupBox(L.t("Graphics engine", "Moteur graphique")) {
                    VStack(alignment: .leading, spacing: 10) {
                        if known == nil {
                            Text(L.t("This game is not in our database yet. Pick an engine, test it, and if it works your rating will save it for everyone.",
                                     "Ce jeu n'est pas encore dans notre base. Choisis un moteur, teste, et si ça marche ta note l'enregistrera pour tout le monde."))
                                .font(.callout)
                                .foregroundStyle(.secondary)
                        } else if let known {
                            Text(L.t("Recommended: \(known.backend.uppercased()). Change it only if you hit problems.",
                                     "Recommandé : \(known.backend.uppercased()). Change seulement en cas de problème."))
                                .font(.callout)
                                .foregroundStyle(.secondary)
                        }
                        Picker("", selection: $chosenBackend) {
                            ForEach(backendChoices, id: \.id) { c in
                                Text(c.label).tag(c.id)
                            }
                        }
                        .pickerStyle(.segmented)
                        .labelsHidden()

                        HStack {
                            Button(L.t("Apply and restart Steam", "Appliquer et relancer Steam")) {
                                let backend = chosenBackend
                                runner.start(L.t("Switching to \(backend.uppercased())",
                                                 "Passage sur \(backend.uppercased())")) { emit, doneCb in
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
                            .disabled(runner.running || chosenBackend == Engine.activeBackend)
                            Text(L.t("Currently active: \(Engine.activeBackend.uppercased())",
                                     "Actif actuellement : \(Engine.activeBackend.uppercased())"))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(4)
                }

                ratingBox

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

    @ViewBuilder
    private var sessionStatus: some View {
        switch session.phase {
        case .idle:
            if let line = session.statusLine {
                Label(line, systemImage: "info.circle").font(.callout).foregroundStyle(.secondary)
            }
        case .launching, .waitingForGame:
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text(session.statusLine ?? L.t("Launching…", "Lancement…"))
                    .font(.callout).foregroundStyle(.secondary)
            }
        case .running:
            Label(L.t("Game is running — have fun! I'm keeping an eye on it.",
                      "Le jeu tourne — amuse-toi ! Je garde un œil dessus."),
                  systemImage: "checkmark.circle.fill")
                .font(.callout).foregroundStyle(.green)
        case .endedOK:
            VStack(alignment: .leading, spacing: 6) {
                Label(L.t("Session over (\(session.ranForSeconds / 60) min). Did it run well?",
                          "Session terminée (\(session.ranForSeconds / 60) min). Ça a bien tourné ?"),
                      systemImage: "flag.checkered")
                    .font(.callout)
                Text(L.t("Rate it below — your rating records the engine that worked for the community.",
                         "Note-le ci-dessous — ta note enregistre le moteur qui marche pour la communauté."))
                    .font(.callout).foregroundStyle(.secondary)
            }
            .padding(10)
            .background(.green.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
        case .crashed:
            VStack(alignment: .leading, spacing: 6) {
                Label(L.t("The game quit after only \(session.ranForSeconds)s — probably a crash.",
                          "Le jeu s'est fermé après seulement \(session.ranForSeconds)s — probablement un crash."),
                      systemImage: "exclamationmark.triangle.fill")
                    .font(.callout).foregroundStyle(.orange)
                Text(crashSuggestion)
                    .font(.callout).foregroundStyle(.secondary)
            }
            .padding(10)
            .background(.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
        case .failed:
            Label(session.statusLine ?? L.t("Launch failed.", "Le lancement a échoué."),
                  systemImage: "xmark.circle")
                .font(.callout).foregroundStyle(.red)
        }
    }

    private var crashSuggestion: String {
        let current = Engine.activeBackend
        let next = current == "d3dmetal" ? "DXVK" : current == "dxvk" ? "DXMT" : "D3DMetal"
        return L.t("Try another engine above (currently \(current.uppercased()) — try \(next)), apply, then hit Play again. If it keeps crashing, rate it 1 star so others know.",
                   "Essaie un autre moteur ci-dessus (actuellement \(current.uppercased()) — tente \(next)), applique, puis relance. Si ça continue de planter, mets 1 étoile pour prévenir les autres.")
    }

    private var ratingBox: some View {
        GroupBox(L.t("How does it run on your Mac?", "Ça tourne comment sur ton Mac ?")) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 6) {
                    ForEach(1...5, id: \.self) { star in
                        Button {
                            rating = star
                        } label: {
                            Image(systemName: star <= rating ? "star.fill" : "star")
                                .font(.title2)
                                .foregroundStyle(star <= rating ? .yellow : .secondary)
                        }
                        .buttonStyle(.plain)
                    }
                    if rating > 0 {
                        Text(ratingLabel(rating)).font(.callout).foregroundStyle(.secondary)
                    }
                }

                TextField(L.t("Optional comment (settings used, fps, issues…)",
                              "Commentaire optionnel (réglages, fps, soucis…)"),
                          text: $comment, axis: .vertical)
                    .lineLimit(2...4)
                    .textFieldStyle(.roundedBorder)

                HStack {
                    Button(L.t("Send my rating", "Envoyer mon avis")) { submit() }
                        .buttonStyle(.borderedProminent)
                        .disabled(rating == 0 || submitting)
                    if submitting { ProgressView().controlSize(.small) }
                    if let feedback {
                        Text(feedback).font(.callout).foregroundStyle(.secondary)
                    }
                }

                Text(L.t("Sent anonymously with your hardware profile and the engine used (\(Engine.activeBackend.uppercased())), so ratings are comparable.",
                         "Envoyé anonymement avec ton profil matériel et le moteur utilisé (\(Engine.activeBackend.uppercased())), pour que les notes soient comparables."))
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(4)
        }
    }

    private func ratingLabel(_ r: Int) -> String {
        switch r {
        case 1: return L.t("Unplayable", "Injouable")
        case 2: return L.t("Rough", "Pénible")
        case 3: return L.t("Playable", "Jouable")
        case 4: return L.t("Runs well", "Tourne bien")
        default: return L.t("Flawless", "Impeccable")
        }
    }

    private func submit() {
        submitting = true
        feedback = nil
        let backend = Engine.activeBackend
        Task {
            do {
                let newStats = try await Hub.submitReport(game: game, rating: rating, comment: comment,
                                                          profile: profile, backend: backend)
                feedback = L.t("Thanks! Your rating is recorded.", "Merci ! Ton avis est enregistré.")
                onSubmitted(newStats)
            } catch {
                feedback = error.localizedDescription
            }
            submitting = false
        }
    }
}
