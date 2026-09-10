# Battery Health (Samsung)

Petite app Android, entièrement autonome, qui automatise la méthode du guide
[r/GalaxyS23](https://www.reddit.com/r/GalaxyS23/comments/1k8ue99/extensive_guidecheck_your_battery_health_and/) :
elle affiche la santé réelle de la batterie sans adb, sans Shizuku et sans root.

Elle combine trois sources, de la plus précise à la plus générale :

1. **Valeur exacte du contrôleur Samsung** (`mSavedBatteryAsoc` dans
   `dumpsys battery`, la donnée du guide Reddit), si le mode précis
   optionnel a été débloqué.
2. **API officielles Android 14+** : nombre de cycles de charge
   (`EXTRA_CYCLE_COUNT`) et état de santé
   (`BATTERY_PROPERTY_STATE_OF_HEALTH`), accessibles à toute app sans
   permission. Un S23 sous One UI 6 est couvert.
3. **Estimation par mesure** : la charge restante rapportée au niveau
   affiché donne la capacité réelle, comparée à la capacité d'origine
   déclarée par le constructeur (PowerProfile).

Affiché : capacité restante en % avec sa provenance, cycles de charge,
capacité mesurée vs capacité d'origine, niveau, température, tension.

## Installation

### Option A : APK depuis GitHub Actions

À chaque push, le workflow `build-battery-app` compile un APK de debug.
Va dans l'onglet **Actions** du repo, ouvre le dernier run, télécharge
l'artefact `BatteryHealth-debug-apk` et installe le `app-debug.apk` sur le
téléphone (il faut autoriser les sources inconnues).

### Option B : Android Studio

Ouvre le dossier `samsung-battery-health/` dans Android Studio et lance
l'app sur ton téléphone (`Run`), ou `./gradlew assembleDebug`.

## Mode précis (optionnel)

L'app marche toute seule dès l'installation. Si tu veux en plus la valeur
exacte du contrôleur Samsung, deux façons de la débloquer une seule fois :

- **adb** : `adb shell pm grant com.arnaud.batteryhealth android.permission.DUMP`
  (bouton pour copier la commande dans l'app, définitif même après redémarrage)
- **[Shizuku](https://shizuku.rikka.app/)** : autorise l'app quand elle le
  demande. Elle en profite pour s'accorder la permission DUMP elle-même,
  donc Shizuku n'est plus nécessaire ensuite.

## Interprétation

| Capacité restante | État |
|---|---|
| ≥ 90 % | Excellente |
| 80 à 89 % | Bonne |
| 70 à 79 % | Moyenne, à surveiller |
| < 70 % | Faible, remplacement à envisager |

Notes :

- L'estimation par mesure est plus fiable quand la batterie est bien
  chargée (au-delà de 80 %) : à bas niveau, la mesure du compteur de
  charge est bruitée.
- Certains firmwares n'implémentent pas `BATTERY_PROPERTY_STATE_OF_HEALTH` ;
  l'app bascule alors automatiquement sur l'estimation.
