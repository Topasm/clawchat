pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
@Suppress("UnstableApiUsage")
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "ClawChat"

include(":app")
include(":core")
include(":feature:onboarding")
include(":feature:today")
include(":feature:chat")
include(":feature:tasks")
include(":feature:inbox")
include(":feature:settings")
include(":widget")
