package com.arnaud.batteryhealth

import kotlin.math.pow

/**
 * Projection d'usure NON linéaire, avec accélération.
 *
 * Physique du modèle : l'énergie consommée par jour est à peu près constante
 * sur la vie du téléphone. Quand la capacité c (fraction de l'origine)
 * baisse, il faut recharger plus souvent : cycles/jour = k / c. Chaque cycle
 * use la batterie, et l'usure par cycle augmente elle-même avec l'âge.
 * D'où dc/dt = -β / c^q, avec q = 1 pour le seul cercle vicieux et q > 1
 * quand on ajoute le vieillissement par cycle. Solution fermée :
 *
 *     c(t)^p = 1 - p·β·t        avec p = q + 1
 *
 * p = 1 serait linéaire ; p = 2 le cercle vicieux pur ; p = 3 (défaut) le
 * cercle vicieux plus le vieillissement. Avec au moins 3 mesures, p est
 * choisi par moindres carrés parmi plusieurs valeurs ; β est toujours ajusté
 * sur les mesures. Plus il y a de captures, plus la courbe est fidèle.
 */
object WearModel {

    private const val DAY_MS = 86_400_000.0
    private const val DEFAULT_P = 3.0
    private val CANDIDATE_P = listOf(1.0, 1.5, 2.0, 2.5, 3.0, 4.0)

    data class Projection(
        val t0: Long,
        val p: Double,
        val beta: Double,
        val points: List<Pair<Long, Int>>,
        val fittedP: Boolean,
    ) {
        val declining: Boolean get() = beta > 0

        /** Capacité en % à l'instant donné, ou 0 une fois la courbe épuisée. */
        fun valueAt(timeMs: Long): Double {
            val days = (timeMs - t0) / DAY_MS
            val base = 1.0 - p * beta * days
            return if (base <= 0) 0.0 else 100.0 * base.pow(1.0 / p)
        }

        /** Vitesse d'usure instantanée en points de % par an. */
        fun yearlyRateAt(timeMs: Long): Double {
            val c = valueAt(timeMs) / 100.0
            if (c <= 0) return 0.0
            return 100.0 * beta / c.pow(p - 1) * 365.25
        }

        fun dateAt(targetPercent: Double, notBefore: Long): Long? {
            if (!declining) return null
            val cp = (targetPercent / 100.0).pow(p)
            val days = (1.0 - cp) / (p * beta)
            val date = t0 + (days * DAY_MS).toLong()
            return date.takeIf { it > notBefore }
        }
    }

    fun build(firstUseMillis: Long?, history: List<Pair<Long, Int>>, nowAsoc: Int?): Projection? {
        val now = System.currentTimeMillis()
        val raw = mutableListOf<Pair<Long, Int>>()
        if (firstUseMillis != null && firstUseMillis < now) raw += firstUseMillis to 100
        raw += history.filter { it.first <= now }
        if (nowAsoc != null && raw.none { now - it.first < DAY_MS }) raw += now to nowAsoc

        val points = raw.sortedBy { it.first }
            .distinctBy { (it.first / DAY_MS).toLong() }
        if (points.size < 2) return null

        val t0 = points.first().first
        val days = points.map { (it.first - t0) / DAY_MS }
        val caps = points.map { it.second / 100.0 }

        // Pour un p donné, y = 1 - c^p = p·β·t : β par moindres carrés passant
        // par l'origine (le premier point est 100 % par construction).
        fun fitBeta(p: Double): Double {
            val num = days.indices.sumOf { days[it] * (1.0 - caps[it].pow(p)) }
            val den = p * days.sumOf { it * it }
            return if (den == 0.0) 0.0 else num / den
        }

        fun error(p: Double, beta: Double): Double = days.indices.sumOf {
            val base = 1.0 - p * beta * days[it]
            val predicted = if (base <= 0) 0.0 else base.pow(1.0 / p)
            (predicted - caps[it]).let { d -> d * d }
        }

        val fitted = points.size >= 3
        val p = if (fitted) {
            CANDIDATE_P.minByOrNull { error(it, fitBeta(it)) } ?: DEFAULT_P
        } else {
            DEFAULT_P
        }
        val beta = fitBeta(p)
        if (beta <= 0) return Projection(t0, p, 0.0, points, fitted)
        return Projection(t0, p, beta, points, fitted)
    }
}
