# Battery Health (Samsung)

Petite app Android qui automatise la méthode du guide
[r/GalaxyS23](https://www.reddit.com/r/GalaxyS23/comments/1k8ue99/extensive_guidecheck_your_battery_health_and/) :
au lieu de lancer un dumpstate avec `*#9900#` et de fouiller le fichier à la
main, l'app lit directement `dumpsys battery` et affiche :

- **Capacité restante** (`mSavedBatteryAsoc`), le vrai % de santé de la batterie
- **Cycles de charge** (`mSavedBatteryUsage` / 100, ou sysfs si dispo)
- Niveau actuel, température, tension

## Installation

### Option A : APK depuis GitHub Actions

À chaque push, le workflow `build-battery-app` compile un APK de debug.
Va dans l'onglet **Actions** du repo, ouvre le dernier run, télécharge
l'artefact `BatteryHealth-debug-apk` et installe le `app-debug.apk` sur le
téléphone (il faut autoriser les sources inconnues).

### Option B : Android Studio

Ouvre le dossier `samsung-battery-health/` dans Android Studio et lance
l'app sur ton téléphone (`Run`), ou `./gradlew assembleDebug`.

## Première configuration (une seule fois)

Les données de santé sont protégées par la permission `DUMP`, réservée au
shell. Deux façons de la débloquer :

### Avec adb (recommandé, définitif)

1. Sur le téléphone : Paramètres → À propos → Informations logiciel →
   tape 7 fois sur "Numéro de version" pour activer les options développeur,
   puis active le **Débogage USB**.
2. Branche le téléphone à un PC avec [adb](https://developer.android.com/tools/releases/platform-tools)
   et lance :

   ```
   adb shell pm grant com.arnaud.batteryhealth android.permission.DUMP
   ```

   (l'app a un bouton pour copier cette commande)

C'est tout : la permission survit aux redémarrages, l'app est autonome à vie.

### Avec Shizuku

Si tu utilises déjà [Shizuku](https://shizuku.rikka.app/), autorise
simplement l'app quand elle le demande. Bonus : l'app en profite pour
s'accorder la permission `DUMP` elle-même, donc Shizuku n'est plus
nécessaire ensuite.

## Interprétation

| Capacité restante | État |
|---|---|
| ≥ 90 % | Excellente |
| 80 à 89 % | Bonne |
| 70 à 79 % | Moyenne, à surveiller |
| < 70 % | Faible, remplacement à envisager |

Note : `mSavedBatteryAsoc` est une estimation du contrôleur de charge
Samsung. Elle est fiable sur les One UI récents, mais certains modèles ou
firmwares ne l'exposent pas (l'app affiche alors "Donnée non exposée").
