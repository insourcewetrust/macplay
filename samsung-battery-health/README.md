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
3. **Capture au déblocage** : pendant que le shell adb est ouvert, l'app
   capture asoc et cycles (y compris via sysfs) et les met en cache.

La santé affichée vient toujours d'une mesure matérielle : l'estimation
"compteur de charge / niveau" a été retirée car sur Samsung le compteur
est dérivé du niveau affiché, ce qui donnait toujours ~100 %.

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

## Valeur exacte du contrôleur Samsung

L'app marche toute seule dès l'installation. Pour obtenir en plus la
valeur exacte (`asoc`), l'app embarque son propre déblocage, sans PC ni
app tierce : bouton **Débloquer**, l'app guide vers "Débogage sans fil"
dans les options développeur, s'appaire toute seule en local (le code
d'association à 6 chiffres affiché par Android est la demande
d'autorisation à l'utilisateur, le port est auto-détecté en mDNS), puis
s'accorde la permission `DUMP` via un shell adb local ([Kadb](https://github.com/flyfishxu/Kadb)).
À faire une seule fois : la permission survit aux redémarrages, et le
débogage sans fil peut être désactivé juste après.

Méthodes avancées équivalentes, si tu préfères :

- **adb depuis un PC** : `adb shell pm grant com.arnaud.batteryhealth android.permission.DUMP`
  (bouton pour copier la commande dans l'app)
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
