import Foundation

/// Model-specific performance estimate.
/// GPU capability = core count x generational uplift (~25% per M generation);
/// game demand derives from its RAM class (a good proxy for how heavy the port
/// is under translation). Calibrated against community datapoints:
/// M4 Pro/Hogwarts ~ 40-45 fps Low+FSR, M4 Pro/Witcher 3 High fluid,
/// M1 base/Witcher 3 ~ 30 fps Low.
enum Perf {
    struct Estimate {
        let fpsRange: String   // "60+", "40-60", "30-40", "20-30"
        let hint: String       // localized advice
    }

    static func estimate(profile: HardwareProfile?, game: GameEntry) -> Estimate? {
        guard let p = profile, p.appleSilicon,
              ["gold", "silver", "bronze"].contains(game.status) else { return nil }

        // generation: digit right after "M" in "Apple M4 Pro"
        var gen = 1
        if let mRange = p.chip.range(of: #"M(\d)"#, options: .regularExpression) {
            gen = Int(p.chip[mRange].dropFirst()) ?? 1
        }
        let defaultCores = ["base": 8, "pro": 16, "max": 32, "ultra": 64]
        let cores = p.gpuCores ?? defaultCores[p.tier] ?? 8
        let score = Double(cores) * pow(1.25, Double(gen - 1))

        let ramMin = game.ram_min_gb ?? 8
        let demand: Double = ramMin <= 8 ? 10 : ramMin <= 12 ? 16 : ramMin <= 16 ? 24 : 34
        let ratio = score / demand

        if ratio >= 1.2 {
            return Estimate(fpsRange: "60+",
                            hint: L.t("smooth at the recommended preset", "fluide au preset recommandé"))
        }
        if ratio >= 0.75 {
            return Estimate(fpsRange: "40-60",
                            hint: L.t("comfortable at the recommended preset", "confortable au preset recommandé"))
        }
        if ratio >= 0.4 {
            return Estimate(fpsRange: "30-40",
                            hint: L.t("drop the preset one notch", "baisse le preset d'un cran"))
        }
        return Estimate(fpsRange: "20-30",
                        hint: L.t("Low preset + upscaling only", "preset Low + upscaling obligatoires"))
    }
}
