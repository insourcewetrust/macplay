package com.fuseau.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.CalendarContract;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.TimeZone;

/**
 * Fuseau Android shell: the web app ships in assets/ and is served from a virtual https origin
 * (so localStorage persists and flight APIs accept the requests). A small JS bridge adds what a
 * web page can't do on Android: writing reminders into the calendar and saving backup files.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.fuseau";
    private static final String ORIGIN = "https://" + HOST + "/";
    private static final int REQ_FILE = 1;
    private static final int REQ_CALENDAR = 2;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private String pendingEvents;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applySystemBars();

        web = new WebView(this);
        web.setBackgroundColor(isNight() ? Color.parseColor("#0D0E19") : Color.parseColor("#F4F1EC"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setSupportMultipleWindows(false);
        s.setTextZoom(100);

        web.addJavascriptInterface(new Bridge(), "FuseauAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                String path = u.getPath();
                if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
                try {
                    InputStream in = getAssets().open("web" + path);
                    return new WebResourceResponse(mime(path), "utf-8", in);
                } catch (Exception e) {
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not found", null, null);
                }
            }

            // String variant: the request variant is API 24+, and its default implementation calls this one.
            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri u = Uri.parse(url);
                if (HOST.equals(u.getHost())) return false;
                // Everything else (RapidAPI signup, sources…) opens outside the app.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (ActivityNotFoundException ignored) {
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(i, "Restaurer une sauvegarde"), REQ_FILE);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(ORIGIN + "index.html");
    }

    private static String mime(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "text/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".woff2")) return "font/woff2";
        if (path.endsWith(".json") || path.endsWith(".webmanifest")) return "application/json";
        return "application/octet-stream";
    }

    private boolean isNight() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    private void applySystemBars() {
        Window w = getWindow();
        boolean night = isNight();
        int bg = night ? Color.parseColor("#0D0E19") : Color.parseColor("#F4F1EC");
        w.setStatusBarColor(bg);
        w.setNavigationBarColor(bg);
        int flags = 0;
        if (!night) {
            flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= 26) flags |= 0x00000010; // SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        }
        w.getDecorView().setSystemUiVisibility(flags);
    }

    @Override
    public void onConfigurationChanged(Configuration c) {
        super.onConfigurationChanged(c);
        applySystemBars();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        if (req == REQ_FILE && fileCallback != null) {
            Uri[] res = null;
            if (result == RESULT_OK && data != null && data.getData() != null) res = new Uri[]{data.getData()};
            fileCallback.onReceiveValue(res);
            fileCallback = null;
            return;
        }
        super.onActivityResult(req, result, data);
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] grants) {
        if (req != REQ_CALENDAR) return;
        String json = pendingEvents;
        pendingEvents = null;
        boolean ok = grants.length > 0;
        for (int g : grants) ok &= g == PackageManager.PERMISSION_GRANTED;
        if (ok && json != null) insertEvents(json);
        else toast("Sans accès au calendrier, pas de rappels. Tu peux l'autoriser dans les réglages Android.");
    }

    private void toast(final String msg) {
        runOnUiThread(new Runnable() {
            public void run() {
                Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show();
            }
        });
    }

    /** Pick the primary writable calendar (Google account first). */
    private long findCalendar(ContentResolver cr) {
        String[] cols = {CalendarContract.Calendars._ID, CalendarContract.Calendars.IS_PRIMARY, CalendarContract.Calendars.ACCOUNT_TYPE};
        String sel = CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL + ">=" + CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR + " AND " + CalendarContract.Calendars.VISIBLE + "=1";
        Cursor c = cr.query(CalendarContract.Calendars.CONTENT_URI, cols, sel, null, null);
        long best = -1;
        int bestScore = -1;
        if (c == null) return -1;
        try {
            while (c.moveToNext()) {
                int score = (c.getInt(1) == 1 ? 2 : 0) + ("com.google".equals(c.getString(2)) ? 1 : 0);
                if (score > bestScore) {
                    bestScore = score;
                    best = c.getLong(0);
                }
            }
        } finally {
            c.close();
        }
        return best;
    }

    private void insertEvents(String json) {
        try {
            ContentResolver cr = getContentResolver();
            long cal = findCalendar(cr);
            if (cal < 0) {
                toast("Aucun calendrier modifiable trouvé sur ce téléphone.");
                return;
            }
            JSONObject root = new JSONObject(json);
            String tag = root.optString("tag");
            // Replace reminders from a previous export of the same trip.
            cr.delete(CalendarContract.Events.CONTENT_URI, CalendarContract.Events.CALENDAR_ID + "=? AND " + CalendarContract.Events.DESCRIPTION + " LIKE ?",
                    new String[]{String.valueOf(cal), "%" + tag + "%"});
            JSONArray evs = root.getJSONArray("events");
            int n = 0;
            for (int i = 0; i < evs.length(); i++) {
                JSONObject e = evs.getJSONObject(i);
                ContentValues v = new ContentValues();
                v.put(CalendarContract.Events.CALENDAR_ID, cal);
                v.put(CalendarContract.Events.DTSTART, e.getLong("start"));
                v.put(CalendarContract.Events.DTEND, e.getLong("end"));
                v.put(CalendarContract.Events.TITLE, e.getString("title"));
                v.put(CalendarContract.Events.DESCRIPTION, e.optString("description") + "\n\n" + tag);
                v.put(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().getID());
                v.put(CalendarContract.Events.AVAILABILITY, CalendarContract.Events.AVAILABILITY_FREE);
                Uri uri = cr.insert(CalendarContract.Events.CONTENT_URI, v);
                if (uri == null) continue;
                n++;
                if (e.optBoolean("alarm")) {
                    ContentValues r = new ContentValues();
                    r.put(CalendarContract.Reminders.EVENT_ID, Long.parseLong(uri.getLastPathSegment()));
                    r.put(CalendarContract.Reminders.MINUTES, 0);
                    r.put(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT);
                    cr.insert(CalendarContract.Reminders.CONTENT_URI, r);
                }
            }
            toast(n + " rappels ajoutés à ton calendrier.");
        } catch (Exception ex) {
            toast("Impossible d'ajouter les rappels : " + ex.getMessage());
        }
    }

    private void saveToDownloads(String name, String mime, String content) throws Exception {
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues v = new ContentValues();
            v.put("_display_name", name);
            v.put("mime_type", mime);
            v.put("relative_path", "Download/");
            Uri uri = getContentResolver().insert(Uri.parse("content://media/external/downloads"), v);
            if (uri == null) throw new Exception("stockage indisponible");
            OutputStream os = getContentResolver().openOutputStream(uri);
            try {
                os.write(bytes);
            } finally {
                os.close();
            }
        } else {
            File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                runOnUiThread(new Runnable() {
                    public void run() {
                        requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, 3);
                    }
                });
                throw new Exception("autorise l'accès au stockage puis réessaie");
            }
            dir.mkdirs();
            FileOutputStream os = new FileOutputStream(new File(dir, name));
            try {
                os.write(bytes);
            } finally {
                os.close();
            }
        }
    }

    private class Bridge {
        @JavascriptInterface
        public void addToCalendar(String json) {
            if (checkSelfPermission(Manifest.permission.WRITE_CALENDAR) == PackageManager.PERMISSION_GRANTED
                    && checkSelfPermission(Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED) {
                insertEvents(json);
            } else {
                pendingEvents = json;
                runOnUiThread(new Runnable() {
                    public void run() {
                        requestPermissions(new String[]{Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR}, REQ_CALENDAR);
                    }
                });
            }
        }

        @JavascriptInterface
        public void saveFile(String name, String mime, String content) {
            try {
                saveToDownloads(name, mime, content);
                toast("Enregistré dans Téléchargements : " + name);
            } catch (Exception e) {
                toast("Enregistrement impossible : " + e.getMessage());
            }
        }

        @JavascriptInterface
        public boolean isAndroid() {
            return true;
        }
    }
}
