import SwiftUI

@main
struct MacPlayApp: App {
    var body: some Scene {
        WindowGroup("MacPlay") {
            ContentView()
                .frame(minWidth: 920, minHeight: 620)
        }
        .defaultSize(width: 1040, height: 680)
    }
}

enum SidebarSection: String, CaseIterable, Identifiable {
    case dashboard
    case games
    case installed
    var id: String { rawValue }
    var label: String {
        switch self {
        case .dashboard: return L.t("My Mac", "Ma machine")
        case .games: return L.t("Games", "Jeux")
        case .installed: return L.t("My games", "Mes jeux")
        }
    }
    var icon: String {
        switch self {
        case .dashboard: return "cpu"
        case .games: return "gamecontroller"
        case .installed: return "star"
        }
    }
}

struct ContentView: View {
    @State private var selection: SidebarSection? = .dashboard
    @AppStorage("lang") private var lang: String = AppLanguage.system.rawValue

    var body: some View {
        NavigationSplitView {
            VStack(spacing: 0) {
                List(SidebarSection.allCases, selection: $selection) { section in
                    Label(section.label, systemImage: section.icon).tag(section)
                }
                Divider()
                HStack(spacing: 8) {
                    Image(systemName: "globe").foregroundStyle(.secondary)
                    Picker(L.t("Language", "Langue"), selection: $lang) {
                        ForEach(AppLanguage.allCases) { l in
                            Text(l.label).tag(l.rawValue)
                        }
                    }
                    .labelsHidden()
                }
                .padding(10)
            }
            .navigationSplitViewColumnWidth(min: 180, ideal: 200)
        } detail: {
            switch selection ?? .dashboard {
            case .dashboard: DashboardView()
            case .games: GamesView()
            case .installed: InstalledView()
            }
        }
        // re-create the whole tree when the language changes so every L.t()
        // call re-evaluates immediately, no relaunch needed
        .id(lang)
    }
}
