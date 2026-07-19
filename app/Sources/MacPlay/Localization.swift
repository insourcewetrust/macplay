import Foundation

/// FR/EN localization. Follows the system language by default, but the user can
/// force one via the "lang" preference ("system" | "fr" | "en"). Views re-read
/// L.fr on every render, and the root view is re-created when the preference
/// changes (see MacPlayApp .id), so switching applies immediately.
enum L {
    static let systemIsFrench = Locale.preferredLanguages.first?.lowercased().hasPrefix("fr") ?? false

    static var fr: Bool {
        switch UserDefaults.standard.string(forKey: "lang") {
        case "fr": return true
        case "en": return false
        default: return systemIsFrench
        }
    }

    static func t(_ en: String, _ frText: String) -> String { fr ? frText : en }
}

enum AppLanguage: String, CaseIterable, Identifiable {
    case system, fr, en
    var id: String { rawValue }
    var label: String {
        switch self {
        case .system: return L.t("System", "Système")
        case .fr: return "Français"
        case .en: return "English"
        }
    }
}
