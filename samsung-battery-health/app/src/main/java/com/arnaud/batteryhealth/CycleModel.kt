package com.arnaud.batteryhealth

/**
 * Cycles de charge cumulés au fil du temps.
 *
 * Hypothèse : l'énergie consommée par jour est constante, donc
 * cycles/jour = k / c(t), où c(t) est la capacité restante fournie par le
 * modèle d'usure. k est calibré pour retrouver le compteur mesuré à la
 * dernière capture. Sans modèle d'usure, c = 1 (rythme constant).
 */
object CycleModel {

    private const val DAY_MS = 86_400_000.0

    class Result(
        val t0: Long,
        private val n0: Int,
        private val k: Double,
        val points: List<Pair<Long, Int>>,
        private val wear: WearModel.Projection?,
    ) {
        private fun capacity(t: Long): Double =
            wear?.let { (it.valueAt(t) / 100.0).coerceAtLeast(0.05) } ?: 1.0

        fun ratePerDayAt(t: Long): Double = k / capacity(t)

        /** Cycles cumulés attendus à l'instant t (intégration jour par jour). */
        fun cumulativeAt(t: Long): Double = n0 + k * integral(t0, t, ::capacity)

        /** Rythme mesuré entre les deux dernières captures, en cycles/jour. */
        fun lastMeasuredRate(): Double? {
            if (points.size < 2) return null
            val (t1, n1) = points[points.size - 2]
            val (t2, n2) = points[points.size - 1]
            val days = (t2 - t1) / DAY_MS
            return if (days > 0) (n2 - n1) / days else null
        }
    }

    private fun integral(from: Long, to: Long, capacity: (Long) -> Double): Double {
        if (to <= from) return 0.0
        var acc = 0.0
        var cur = from
        val step = DAY_MS.toLong()
        while (cur < to) {
            val next = minOf(cur + step, to)
            acc += ((next - cur) / DAY_MS) / capacity(cur)
            cur = next
        }
        return acc
    }

    fun build(
        firstUseMillis: Long?,
        cyclePoints: List<Pair<Long, Int>>,
        wear: WearModel.Projection?,
    ): Result? {
        val now = System.currentTimeMillis()
        val raw = mutableListOf<Pair<Long, Int>>()
        if (firstUseMillis != null && firstUseMillis < now) raw += firstUseMillis to 0
        raw += cyclePoints.filter { it.first <= now && it.second >= 0 }
        val points = raw.sortedBy { it.first }
            .distinctBy { (it.first / DAY_MS).toLong() }
        if (points.size < 2) return null

        val t0 = points.first().first
        val n0 = points.first().second
        val last = points.last()
        val capacity: (Long) -> Double = { t ->
            wear?.let { (it.valueAt(t) / 100.0).coerceAtLeast(0.05) } ?: 1.0
        }
        val unit = integral(t0, last.first, capacity)
        if (unit <= 0) return null
        val k = (last.second - n0) / unit
        if (k <= 0) return null
        return Result(t0, n0, k, points, wear)
    }
}
