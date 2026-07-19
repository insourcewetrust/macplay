import Foundation

/// Launches a game through the wrapper's Steam client and watches its process:
/// if the game disappears shortly after appearing, it most likely crashed and
/// the UI can suggest trying another graphics backend.
final class GameSession: ObservableObject {
    enum Phase {
        case idle
        case launching       // Steam starting / -applaunch sent
        case waitingForGame  // Steam is up, game process not seen yet (download/updates possible)
        case running
        case endedOK         // ran long enough, normal exit
        case crashed         // died within the crash window
        case failed          // could not even request the launch
    }

    @Published var phase: Phase = .idle
    @Published var statusLine: String?
    @Published var ranForSeconds: Int = 0

    static let crashWindow: TimeInterval = 45
    private static let appearTimeout: TimeInterval = 300  // downloads/updates can delay first launch

    private var generation = 0

    func play(_ game: InstalledGame) {
        generation += 1
        let gen = generation
        phase = .launching
        statusLine = nil

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let ok = Engine.launchGameSync(appid: game.appid) { line in
                DispatchQueue.main.async { if self?.generation == gen { self?.statusLine = line } }
            }
            guard ok else {
                DispatchQueue.main.async { if self?.generation == gen { self?.phase = .failed } }
                return
            }
            DispatchQueue.main.async { if self?.generation == gen { self?.phase = .waitingForGame } }

            let pattern = game.processPattern
            let started = Date()
            var appeared: Date?

            while true {
                Thread.sleep(forTimeInterval: 3)
                guard let self, self.generationMatches(gen) else { return }
                let alive = Engine.processAlive(pattern)

                if appeared == nil {
                    if alive {
                        appeared = Date()
                        DispatchQueue.main.async { if self.generation == gen { self.phase = .running } }
                    } else if Date().timeIntervalSince(started) > Self.appearTimeout {
                        DispatchQueue.main.async {
                            if self.generation == gen {
                                self.phase = .idle
                                self.statusLine = L.t("Game process not seen — maybe still downloading or updating in Steam.",
                                                      "Process du jeu non détecté — peut-être encore en téléchargement ou mise à jour dans Steam.")
                            }
                        }
                        return
                    }
                } else if !alive {
                    let ranFor = Date().timeIntervalSince(appeared!)
                    DispatchQueue.main.async {
                        if self.generation == gen {
                            self.ranForSeconds = Int(ranFor)
                            self.phase = ranFor < Self.crashWindow ? .crashed : .endedOK
                        }
                    }
                    return
                }
            }
        }
    }

    private func generationMatches(_ gen: Int) -> Bool {
        var result = false
        DispatchQueue.main.sync { result = (generation == gen) }
        return result
    }
}
