# APK Android

L'application 301 empaquetée pour Android : une WebView plein écran qui charge
l'appli web depuis `assets/`. **Tout tourne hors ligne sur le téléphone** — aucun
serveur, aucune connexion, aucune permission demandée.

L'APK prêt à installer est à la racine du dossier : **[`301-flechettes.apk`](301-flechettes.apk)**.

## Installer

1. Copier le fichier `.apk` sur le téléphone (câble, mail, Drive, peu importe).
2. L'ouvrir depuis le gestionnaire de fichiers.
3. Android demande d'autoriser l'installation depuis cette source : accepter.
   Play Protect peut afficher un avertissement (application non signée par un
   éditeur connu) — « Installer quand même ».

Android 7.0 minimum. L'app apparaît sous le nom **301 Fléchettes**.

## Reconstruire

```bash
./build.sh                              # → out/301-flechettes.apk
VERSION_CODE=2 VERSION_NAME=1.1 ./build.sh
```

Prérequis : un **JDK** (`javac`, `java`, `keytool`) et **python3**. Pas besoin
d'Android Studio ni du SDK Android.

Le script télécharge sa chaîne d'outils depuis Maven Central au premier lancement :

| Outil | Rôle |
| --- | --- |
| `dalvik-dx` | compile les `.class` en `classes.dex` |
| `ARSCLib` | écrit `AndroidManifest.xml` en XML binaire et `resources.arsc` |
| `apksig` | signature APK v2 |
| `android-4.1.1.4.jar` | stubs du framework pour la compilation |

Puis : icône (PNG dessiné par `tools/make_icon.py`, sans dépendance) →
compilation → dex → manifeste → assemblage du zip → signature.

### Pourquoi pas le SDK Android ?

`dl.google.com` n'était pas joignable depuis l'environnement de développement.
Toute la chaîne vient donc de Maven Central. C'est aussi ce qui rend le build
léger : une poignée de jars, pas 1 Go de SDK.

Deux conséquences assumées :

- **Signature v2 uniquement.** L'`apksig` disponible sur Maven Central est
  ancien et sa signature v1 s'appuie sur des API du JDK supprimées depuis. Le v2
  seul impose Android 7.0 minimum — c'est ce que déclare le manifeste
  (`minSdkVersion 24`). C'est aussi le schéma qu'exige Android 11+, donc rien ne
  manque côté moderne.
- **`resources.arsc` aligné à la main.** Depuis Android 11 il doit être stocké
  non compressé et aligné sur 4 octets ; `tools/pack.py` s'en charge, faute de
  `zipalign`.

## Vérifier

```bash
python3 tools/verify.py out/301-flechettes.apk
```

Contrôle ce qu'Android contrôle à l'installation : intégrité du zip,
`resources.arsc` non compressé et aligné, bloc de signature v2, cohérence du
manifeste (paquet, activité lançable, `android:exported`, minSdk/targetSdk,
icône, absence de permission) et présence de l'activité dans `classes.dex`.
Le contrôle du manifeste et du dex nécessite `androguard` (`pip install
androguard`) ; sans lui, le reste s'exécute quand même.

## Mettre à jour l'app installée

La clé de signature (`keystore.p12`) est créée au premier build et **n'est pas
versionnée**. Tant que tu gardes ce fichier, tu peux réinstaller par-dessus une
version existante. Si tu le perds, Android refusera la mise à jour : il faudra
désinstaller l'app avant de réinstaller (la partie en cours est alors perdue,
mais pas grand-chose d'autre).

## Contenu de l'APK

```
AndroidManifest.xml     manifeste binaire (paquet fr.macplay.darts301)
classes.dex             l'activité WebView, ~40 lignes de Java
resources.arsc          une seule ressource : l'icône
res/mipmap/ic_launcher.png
assets/                 index.html, app.js, style.css, lib/*.js
```

37 Ko au total.
