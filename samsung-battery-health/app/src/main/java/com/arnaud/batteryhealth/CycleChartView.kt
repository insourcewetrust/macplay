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
import kotlin.math.ceil

/**
 * Cycles cumulés : points mesurés en trait plein, projection en pointillés
 * (même modèle que la courbe d'usure), grille discrète, une seule série.
 */
class CycleChartView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : View(context, attrs) {

    private var model: CycleModel.Result? = null

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

    fun setModel(m: CycleModel.Result?) {
        model = m
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val m = model
        val padLeft = 44 * density
        val padRight = 16 * density
        val padTop = 14 * density
        val padBottom = 26 * density
        val w = width.toFloat()
        val h = height.toFloat()
        val plotLeft = padLeft
        val plotRight = w - padRight
        val plotTop = padTop
        val plotBottom = h - padBottom

        if (m == null) {
            canvas.drawLine(plotLeft, plotBottom, plotRight, plotBottom, gridPaint)
            textPaint.textAlign = Paint.Align.CENTER
            canvas.drawText(
                context.getString(R.string.cycles_no_data),
                (plotLeft + plotRight) / 2, (plotTop + plotBottom) / 2, textPaint,
            )
            return
        }

        val now = System.currentTimeMillis()
        val xStart = m.t0
        val xEnd = now + 3L * 365 * 86_400_000L
        fun xPx(t: Long): Float =
            plotLeft + ((t - xStart).toFloat() / (xEnd - xStart).toFloat()) * (plotRight - plotLeft)

        // Échelle verticale : de 0 au maximum projeté, arrondi à un pas lisible.
        val projectedMax = maxOf(m.cumulativeAt(xEnd), m.points.last().second.toDouble())
        val step = listOf(100, 250, 500, 1000, 2000, 5000).first { projectedMax / it <= 5 }
        val yMax = (ceil(projectedMax / step) * step).toFloat().coerceAtLeast(step.toFloat())
        fun yPx(v: Double): Float =
            plotBottom - (v.toFloat().coerceIn(0f, yMax) / yMax) * (plotBottom - plotTop)

        // Grille horizontale avec ses libellés.
        var v = 0
        while (v <= yMax) {
            val y = yPx(v.toDouble())
            canvas.drawLine(plotLeft, y, plotRight, y, gridPaint)
            textPaint.textAlign = Paint.Align.RIGHT
            canvas.drawText(v.toString(), plotLeft - 6 * density, y + 4 * density, textPaint)
            v += step
        }

        // Repères d'années.
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

        // Passé : points mesurés reliés.
        val path = Path()
        m.points.forEachIndexed { i, (t, n) ->
            val x = xPx(t)
            val y = yPx(n.toDouble())
            if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        canvas.drawPath(path, linePaint)

        // Futur : projection en pointillés.
        val lastT = m.points.last().first
        val proj = Path()
        proj.moveTo(xPx(lastT), yPx(m.points.last().second.toDouble()))
        val samples = 60
        for (i in 1..samples) {
            val t = lastT + (xEnd - lastT) * i / samples
            proj.lineTo(xPx(t), yPx(m.cumulativeAt(t)))
        }
        canvas.drawPath(proj, projectionPaint)

        // Marqueurs et libellé du dernier point mesuré.
        val radius = 4 * density
        m.points.forEach { (t, n) ->
            val x = xPx(t)
            val y = yPx(n.toDouble())
            canvas.drawCircle(x, y, radius + 1 * density, markerRingPaint)
            canvas.drawCircle(x, y, radius, markerPaint)
        }
        val (lt, ln) = m.points.last()
        textPaint.textAlign = Paint.Align.LEFT
        val label = ln.toString()
        val lx = xPx(lt)
        val tw = textPaint.measureText(label)
        val tx = if (lx + 6 * density + tw > plotRight) lx - tw - 6 * density else lx + 6 * density
        canvas.drawText(label, tx, yPx(ln.toDouble()) - 8 * density, textPaint)
    }
}
