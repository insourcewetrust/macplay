# Fuseau

Un plan anti-jet lag réaliste, heure par heure. Web app installable (PWA), 100 % locale, en français.

## Ce qu'elle fait

- **Ajout de vol en 3 façons** : numéro de vol + date (trajet retrouvé automatiquement), trajet à la main
  (arrivée estimée d'après la distance), ou copier-coller d'une confirmation de réservation (aller et retour
  détectés, un plan créé pour chacun). Correspondances gérées.
- **Plan porte à porte** : trajet vers l'aéroport (VTC, taxi, train…), attente, vol, escales, sortie, trajet
  vers le logement. Les consignes de lumière tombent pile dans le VTC ou le terminal, et tiennent compte du
  jour ou de la nuit dehors (position du soleil).
- **Sommeil en vol réaliste** : jamais à la porte d'embarquement ni au décollage, service repas pris en
  compte, seulement quand c'est la nuit à destination et que ton horloge le permet (ou quand la dette de
  sommeil devient trop grosse sur un très long voyage).
- **Lumière** : fenêtres « cherche / évite » calculées chaque jour à partir du point bas de température.
- **Mélatonine** (0,5 à 1 mg, timing), **caféine et théine** (limite 8 h avant le coucher, coups de pouce
  quand le corps est en pleine nuit), **siestes**, hydratation, circulation.
- **Préparation optionnelle** 1 à 3 jours avant, **mode séjour court** (rester à l'heure de chez soi).
- **Maintenant** : ce qu'il faut faire à l'instant, et l'heure que ton corps croit qu'il est.
- **Guide** sourcé (Cochrane, ANSES, EFSA, études de référence) et export des rappels vers le calendrier (.ics).

## Horaires exacts automatiques

Sans configuration, le numéro de vol donne le trajet (adsbdb.com) et l'arrivée est estimée.
Avec une clé gratuite AeroDataBox (RapidAPI, à coller dans Profil), l'app récupère les horaires exacts et
peut lister tous les vols d'un trajet pour une date.

## Développement

```sh
npm install
npm run dev          # http://localhost:5173
npm test             # moteur + lecture de réservations
npm run build        # dist/ : PWA à déployer (GitHub Pages, Netlify…)
npm run build:single # dist-single/index.html : un seul fichier autonome
```

`?now=2026-10-12T00:10:00Z` dans l'URL fige l'horloge, pratique pour tester un voyage.

Le modèle est dans `src/lib/engine.ts`, les contenus du guide dans `src/content/guide.ts`.
Les données d'aéroports se régénèrent avec `scripts/build-airports.py` (OurAirports + mwgg/Airports) et
`scripts/build-airlines.py` (OpenFlights).

## Application Android

L'APK signé est dans [`release/fuseau.apk`](release/fuseau.apk) (Android 6 et plus). Sur le téléphone :
télécharge-le, ouvre-le, autorise l'installation depuis cette source, puis « Installer ».

C'est la même app, embarquée dans une WebView native (`android/`), avec en plus :
- **Ajout au calendrier** : les rappels (lumière, mélatonine, dernier café, trajets…) vont directement
  dans ton agenda Android, avec alerte. Un nouvel export remplace l'ancien pour ce voyage.
- **Sauvegarde** dans le dossier Téléchargements, **restauration** via le sélecteur de fichiers.
- Bouton retour Android, barres système aux couleurs de l'app (clair et sombre), fonctionne hors ligne.

Reconstruire (sans Android Studio ni Gradle) :

```sh
sudo apt-get install aapt apksigner zipalign dalvik-exchange android-sdk-platform-23
android/build-apk.sh   # -> release/fuseau.apk
```

La clé de signature `android/fuseau.keystore` est versionnée pour que chaque nouvelle version s'installe
par-dessus l'ancienne sans perdre tes données. Pour une diffusion publique, utilise ta propre clé
(`KEYSTORE=… KEYSTORE_PASS=… android/build-apk.sh`).

Ce n'est pas un dispositif médical.
