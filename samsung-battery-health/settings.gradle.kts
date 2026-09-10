pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // spake2-java, dépendance transitive de Kadb pour l'appairage adb
        maven("https://jitpack.io")
    }
}
rootProject.name = "BatteryHealth"
include(":app")
