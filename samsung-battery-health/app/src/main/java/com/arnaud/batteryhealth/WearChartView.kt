package com.arnaud.batteryhealth

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.util.AttributeSet
import android.view.View
import com.google.android.material.color.MaterialColors
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/**
 * Courbe d'usure : points mesurés reliés en trait plein, projection en
 * pointillés, seuils 80 % et 70 % annotés en texte (jamais par la couleur
 * seule), grille discrète. Une seule série, donc pas de légende.
 */
class WearChartView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : View(context, attrs) {

    private var projection: WearModel.Projection? = null

    private val density = resources.displayMetrics.density
    private val lineColor = MaterialColors.getColor(
        this, com.google.android.material.R.attr.colorPrimary, Color.BLUE)
    private val textColor = MaterialColors.getColor(
        this, android.R.attr.textColorSecondary, Color.GRAY)
    private val gridColor = MaterialColors.getColor(
        this, com.google.android.material.R.attr.colorOutlineVariant, Color.LTGRAY)
    private val surfaceColor = MaterialColors.getColor(
        this, com.google.android.material.R.attr.colorSurface, Color.WHITE)

    private val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = lineColor
        strokeWidth = 2 * density
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val projectionPaint = Paint(linePaint).apply {
        pathEffect = DashPathEffect(floatArrayOf(6 * density, 5 * density), 0f)
    }
    private val gridPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = gridColor
        strokeWidth = 1 * density
    }
    private val thresholdPaint = Paint(gridPaint).apply {
        pathEffect = DashPathEffect(floatArrayOf(3 * density, 3 * density), 0f)
        color = textColor
        alpha = 110
    }
    private val markerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = lineColor
        style = Paint.Style.FILL
    }
    private val markerRingPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = surfaceColor
        style = Paint.Style.STROKE
        strokeWidth = 2 * density
    }
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = textColor
        textSize = 11 * resources.displayMetrics.scaledDensity
    }

    private val yearFormat = SimpleDateFormat("yyyy", Locale.ENGLISH)
    private val monthFormat = SimpleDateFormat("MMM yyyy", Locale.ENGLISH)

    fun setProjection(p: WearModel.Projection?) {
        projection = p
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val p = projection
        val padLeft = 40 * density
        val padRight = 16 * density
        val padTop = 14 * density
        val padBottom = 26 * density
        val w = width.toFloat()
        val h = height.toFloat()
        val plotLeft = padLeft
        val plotRight = w - padRight
        val plotTop = padTop
        val plotBottom = h - padBottom

        val yMin = 60f
        val yMax = 100f
        fun yPx(v: Double): Float =
            plotBottom - ((v.toFloat().coerceIn(yMin, yMax) - yMin) / (yMax - yMin)) * (plotBottom - plotTop)

        // Grille horizontale discrète avec ses libellés.
        for (v in 60..100 step 10) {
            val y = yPx(v.toDouble())
            canvas.drawLine(plotLeft, y, plotRight, y, if (v == 80 || v == 70) thresholdPaint else gridPaint)
            textPaint.textAlign = Paint.Align.RIGHT
            canvas.drawText("$v %", plotLeft - 6 * density, y + 4 * density, textPaint)
        }

        if (p == null) {
            textPaint.textAlign = Paint.Align.CENTER
            canvas.drawText(
                context.getString(R.string.wear_no_data),
                (plotLeft + plotRight) / 2, (plotTop + plotBottom) / 2, textPaint,
            )
            return
        }

        val now = System.currentTimeMillis()
        val threeYears = 3L * 365 * 86_400_000L
        val sixYears = 6L * 365 * 86_400_000L
        val xStart = p.t0
        var xEnd = now + threeYears
        p.dateAt(70.0, now)?.let { xEnd = maxOf(xEnd, it + 180L * 86_400_000L) }
        xEnd = minOf(xEnd, now + sixYears)
        fun xPx(t: Long): Float =
            plotLeft + ((t - xStart).toFloat() / (xEnd - xStart).toFloat()) * (plotRight - plotLeft)

        // Repères d'années sur l'axe du temps.
        val cal = Calendar.getInstance().apply {
            timeInMillis = xStart
            set(Calendar.MONTH, Calendar.JANUARY)
            set(Calendar.DAY_OF_MONTH, 1)
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
            add(Calendar.YEAR, 1)
        }
        textPaint.textAlign = Paint.Align.CENTER
        while (cal.timeInMillis < xEnd) {
            val x = xPx(cal.timeInMillis)
            canvas.drawLine(x, plotTop, x, plotBottom, gridPaint)
            canvas.drawText(yearFormat.format(cal.time), x, h - 8 * density, textPaint)
            cal.add(Calendar.YEAR, 1)
        }

        // Passé : les points mesurés reliés en trait plein.
        val path = Path()
        p.points.forEachIndexed { i, (t, v) ->
            val x = xPx(t)
            val y = yPx(v.toDouble())
            if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        canvas.drawPath(path, linePaint)

        // Futur : la tendance en pointillés, jusqu'au bord ou jusqu'à 60 %.
        val lastT = p.points.last().first
        val proj = Path()
        proj.moveTo(xPx(lastT), yPx(p.valueAt(lastT)))
        var t = lastT
        val step = (xEnd - lastT) / 120
        if (step > 0) {
            while (t < xEnd) {
                t += step
                val v = p.valueAt(t)
                if (v < yMin) break
                proj.lineTo(xPx(t), yPx(v))
            }
            canvas.drawPath(proj, projectionPaint)
        }

        // Marqueurs des points mesurés, avec anneau couleur surface.
        val radius = 4 * density
        p.points.forEach { (tp, v) ->
            val x = xPx(tp)
            val y = yPx(v.toDouble())
            canvas.drawCircle(x, y, radius + 1 * density, markerRingPaint)
            canvas.drawCircle(x, y, radius, markerPaint)
        }

        // Annotation des seuils atteints, en texte.
        textPaint.textAlign = Paint.Align.LEFT
        listOf(80.0 to p.dateAt(80.0, now), 70.0 to p.dateAt(70.0, now)).forEach { (level, date) ->
            if (date != null && date < xEnd) {
                val x = xPx(date)
                val y = yPx(level)
                canvas.drawCircle(x, y, 3 * density, markerPaint)
                val label = "${level.toInt()} % · ${monthFormat.format(java.util.Date(date))}"
                val tw = textPaint.measureText(label)
                val tx = if (x + 6 * density + tw > plotRight) x - tw - 6 * density else x + 6 * density
                canvas.drawText(label, tx, y - 6 * density, textPaint)
            }
        }
    }
}
