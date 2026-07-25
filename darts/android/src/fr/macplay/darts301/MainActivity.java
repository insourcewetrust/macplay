package fr.macplay.darts301;

import android.app.Activity;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;

/**
 * Coquille de l'application : une WebView plein écran qui charge l'appli 301
 * empaquetée dans assets/. Tout le jeu tourne hors ligne dans la page.
 */
public class MainActivity extends Activity {

    private static final int BACKGROUND = 0xFF0E1116; // identique au fond CSS

    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        super.onCreate(savedInstanceState);
        getWindow().setBackgroundDrawable(new ColorDrawable(BACKGROUND));
        // un tableau de scores posé sur la table ne doit pas s'éteindre en pleine partie
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true); // la partie en cours est stockée là
        settings.setAllowFileAccess(true);
        settings.setSupportZoom(false);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        web.setBackgroundColor(BACKGROUND);
        web.setOverScrollMode(WebView.OVER_SCROLL_NEVER);

        setContentView(web);
        if (savedInstanceState == null) {
            web.loadUrl("file:///android_asset/index.html");
        } else {
            web.restoreState(savedInstanceState);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        // on met l'appli en arrière-plan plutôt que de la fermer en pleine volée
        moveTaskToBack(true);
    }
}
