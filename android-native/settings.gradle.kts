pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolution {
    @Suppress("UnstableApiUsage")
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
include(":feature:settings")
include(":widget")
