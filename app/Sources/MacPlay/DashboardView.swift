import SwiftUI

/// Runs one long engine action at a time and exposes its live log.
final class ActionRunner: ObservableObject {
    @Published var log: [String] = []
    @Published var running = false
    @Published var lastExit: Int32? = nil

    func start(_ label: String,
               _ op: @escaping (_ emit: @escaping (String) -> Void, _ done: @escaping (Int32) -> Void) -> Void) {
        guard !running else { return }
        running = true
        lastExit = nil
        log = ["▶ " + label]
        op({ line in
            DispatchQueue.main.async { self.log.append(line) }
        }, { code in
            DispatchQueue.main.async {
                self.running = false
                self.lastExit = code
                self.log.append(code == 0 ? L.t("✓ Done", "✓ Terminé") : L.t("✗ Failed (\(code))", "✗ Échec (\(code))"))
            }
        })
    }
}

struct DashboardView: View {
    @State private var report: DoctorReport?
    @State private var confirmUninstall = false
    @State private var confirmReinstall = false
    @StateObject private var runner = ActionRunner()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text(L.t("My Mac", "Ma machine"))
                    .font(.largeTitle.bold())

                if let r = report {
                    HStack(spacing: 12) {
                        StatCard(title: L.t("Chip", "Puce"), value: r.profile.chip)
                        StatCard(title: L.t("Memory", "Mémoire"), value: "\(r.profile.ramGB) \(L.t("GB", "Go"))")
                        StatCard(title: "GPU", value: r.profile.gpuCores.map { "\($0) \(L.t("cores", "cœurs"))" } ?? "—")
                        StatCard(title: "macOS", value: r.profile.macosVersion)
                    }

                    GroupBox(L.t("System health", "État du système")) {
                        VStack(alignment: .leading, spacing: 8) {
                            HealthRow(ok: r.profile.appleSilicon,
                                      text: r.profile.appleSilicon
                                        ? L.t("Apple Silicon detected", "Apple Silicon détecté")
                                        : L.t("Intel Mac: performance will be poor", "Mac Intel : performances médiocres"))
                            HealthRow(ok: r.profile.rosetta,
                                      text: r.profile.rosetta
                                        ? L.t("Rosetta 2 installed", "Rosetta 2 installé")
                                        : L.t("Rosetta 2 missing (required)", "Rosetta 2 manquant (requis)"))
                            HealthRow(ok: !r.swapSaturated,
                                      text: String(format: L.t("Swap: %.1f / %.1f GB used", "Swap : %.1f / %.1f Go utilisés"),
                                                   r.swapUsedGB, r.swapTotalGB)
                                        + (r.swapSaturated
                                            ? L.t(" — close some apps before playing (main cause of lag)",
                                                  " — ferme des apps avant de jouer (cause n°1 de lag)")
                                            : ""))
                            HealthRow(ok: r.diskFreeGB > 30,
                                      text: String(format: L.t("Disk: %.0f GB free", "Disque : %.0f Go libres"), r.diskFreeGB))
                            if r.wrapperInstalled {
                                HealthRow(ok: true,
                                          text: L.t("Wrapper ready — engine: ", "Wrapper prêt — moteur : ")
                                            + (r.engineVersion ?? "?")
                                            + L.t(" — backend: ", " — backend : ") + r.activeBackend)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(4)
                    }
                } else {
                    ProgressView().controlSize(.small)
                }

                GroupBox(L.t("Windows Steam", "Steam Windows")) {
                    VStack(alignment: .leading, spacing: 10) {
                        if report?.wrapperInstalled == true {
                            if report?.steamRunning == true {
                                Label(L.t("Steam is running.", "Steam est en cours d'exécution."),
                                      systemImage: "checkmark.circle.fill")
                                    .foregroundStyle(.green)
                            } else {
                                Label(L.t("Steam is installed.", "Steam est installé."),
                                      systemImage: "checkmark.circle.fill")
                                    .foregroundStyle(.green)
                            }
                            Text(L.t("Steam updates itself when it launches — that's normal. Let the update finish before playing.",
                                     "Steam se met à jour à son lancement — c'est normal. Laisse la mise à jour se terminer avant de jouer."))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            HStack {
                                Button(L.t("Restart Steam cleanly", "Relancer Steam proprement")) {
                                    runner.start(L.t("Restarting the Steam session", "Redémarrage de la session Steam"),
                                                 Engine.restart)
                                }
                                .disabled(runner.running)
                                Text(L.t("Do this after any configuration change.",
                                         "À faire après tout changement de configuration."))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            HStack {
                                Button(L.t("Reinstall Steam…", "Réinstaller Steam…")) { confirmReinstall = true }
                                    .disabled(runner.running)
                                Button(role: .destructive) { confirmUninstall = true } label: {
                                    Text(L.t("Uninstall Steam…", "Désinstaller Steam…"))
                                }
                                .disabled(runner.running)
                            }
                            .confirmationDialog(
                                L.t("Reinstall Steam from scratch? Installed games will be deleted too.",
                                    "Réinstaller Steam de zéro ? Les jeux installés seront aussi supprimés."),
                                isPresented: $confirmReinstall, titleVisibility: .visible
                            ) {
                                Button(L.t("Reinstall everything", "Tout réinstaller"), role: .destructive) {
                                    runner.start(L.t("Full reinstall", "Réinstallation complète"), Engine.reinstallSteam)
                                }
                            }
                            .confirmationDialog(
                                L.t("Uninstall Steam? The wrapper AND all games installed inside will be deleted.",
                                    "Désinstaller Steam ? Le wrapper ET tous les jeux installés dedans seront supprimés."),
                                isPresented: $confirmUninstall, titleVisibility: .visible
                            ) {
                                Button(L.t("Uninstall everything", "Tout désinstaller"), role: .destructive) {
                                    runner.start(L.t("Uninstalling Steam", "Désinstallation de Steam"), Engine.uninstallSteam)
                                }
                            }
                        } else {
                            Label(L.t("Steam is not installed yet.", "Steam n'est pas encore installé."),
                                  systemImage: "exclamationmark.circle")
                                .foregroundStyle(.orange)
                            HStack {
                                Button(L.t("Install Steam (~450 MB)", "Installer Steam (~450 Mo)")) {
                                    runner.start(L.t("Full Steam installation", "Installation complète de Steam"),
                                                 Engine.setupSteam)
                                }
                                .buttonStyle(.borderedProminent)
                                .disabled(runner.running)
                                Text(L.t("10-15 minutes. Fully automatic.", "10 à 15 minutes. Tout est automatique."))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(4)
                }

                if !runner.log.isEmpty {
                    LogPanel(runner: runner)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(24)
        }
        .task { await refresh() }
        .onChange(of: runner.running) { isRunning in
            if !isRunning { Task { await refresh() } }
        }
    }

    private func refresh() async {
        report = await Task.detached(priority: .userInitiated) { Engine.doctor() }.value
    }
}

struct HealthRow: View {
    let ok: Bool
    let text: String

    var body: some View {
        Label {
            Text(text)
        } icon: {
            Image(systemName: ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                .foregroundStyle(ok ? .green : .orange)
        }
        .font(.callout)
    }
}

struct StatCard: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.headline)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 10))
    }
}

struct LogPanel: View {
    @ObservedObject var runner: ActionRunner

    var body: some View {
        GroupBox {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(Array(runner.log.enumerated()), id: \.offset) { i, line in
                            Text(line)
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(.secondary)
                                .id(i)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(height: 180)
                .onChange(of: runner.log.count) { count in
                    proxy.scrollTo(count - 1, anchor: .bottom)
                }
            }
        } label: {
            HStack {
                Text(L.t("Log", "Journal"))
                if runner.running { ProgressView().controlSize(.mini) }
            }
        }
    }
}
