package com.arnaud.batteryhealth

/**
 * Projection linéaire de l'usure : régression aux moindres carrés sur les
 * points connus (100 % à la première utilisation, puis chaque capture).
 * Une batterie Li-ion s'use à peu près linéairement après sa première
 * baisse, donc l'extrapolation donne un ordre de grandeur honnête ; elle
 * s'affine à chaque nouvelle capture.
 */
object WearModel {

    private const val DAY_MS = 86_400_000.0

    data class Projection(
        val t0: Long,
        val intercept: Double,
        val slopePerDay: Double,
        val points: List<Pair<Long, Int>>,
        val monthlyLoss: Double,
        val yearlyLoss: Double,
        val dateAt80: Long?,
        val dateAt70: Long?,
    ) {
        fun valueAt(timeMs: Long): Double = intercept + slopePerDay * ((timeMs - t0) / DAY_MS)
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
        val xs = points.map { (it.first - t0) / DAY_MS }
        val ys = points.map { it.second.toDouble() }
        val mx = xs.average()
        val my = ys.average()
        val sxx = xs.sumOf { (it - mx) * (it - mx) }
        if (sxx == 0.0) return null
        val slope = xs.indices.sumOf { (xs[it] - mx) * (ys[it] - my) } / sxx
        val intercept = my - slope * mx

        fun dateAt(target: Double): Long? {
            if (slope >= 0) return null
            val days = (target - intercept) / slope
            val date = t0 + (days * DAY_MS).toLong()
            return date.takeIf { it > now }
        }

        return Projection(
            t0 = t0,
            intercept = intercept,
            slopePerDay = slope,
            points = points,
            monthlyLoss = -slope * 30.4375,
            yearlyLoss = -slope * 365.25,
            dateAt80 = dateAt(80.0),
            dateAt70 = dateAt(70.0),
        )
    }
}
