plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.hilt)
    alias(libs.plugins.ksp)
}

/**
 * Android refuses to install an APK whose versionCode is lower than the
 * installed one, so the in-app updater needs the code to track the released
 * semantic version rather than a hand-maintained counter.
 */
fun androidVersionCode(versionName: String): Int {
    val match = Regex("""^(\d+)\.(\d+)\.(\d+)""").find(versionName)
        ?: throw GradleException("versionName is not a semantic version: $versionName")
    val (major, minor, patch) = match.destructured
    return major.toInt() * 1_000_000 + minor.toInt() * 1_000 + patch.toInt()
}

/** Release signing is configured only when every keystore value is present. */
fun releaseSigningProperty(name: String): String? =
    (project.findProperty(name) as? String ?: System.getenv(name))?.takeIf { it.isNotBlank() }

/**
 * A half-configured keystore is a mistake rather than a choice: it would
 * produce an APK signed with a different key, which no installed copy of
 * ClawChat can accept as an update.
 */
fun requireSigningProperty(name: String): String = releaseSigningProperty(name)
    ?: throw GradleException("$name is required when ANDROID_KEYSTORE_FILE is set")

android {
    namespace = "com.clawchat.android"
    compileSdk = libs.versions.compileSdk.get().toInt()

    defaultConfig {
        applicationId = "com.clawchat.android"
        minSdk = libs.versions.minSdk.get().toInt()
        targetSdk = libs.versions.targetSdk.get().toInt()
        versionName = "1.4.23"
        versionCode = androidVersionCode(versionName!!)
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // The in-app updater reads published releases of this repository.
        buildConfigField(
            "String",
            "UPDATE_REPOSITORY",
            "\"${project.findProperty("UPDATE_REPOSITORY") as? String ?: "Topasm/clawchat"}\"",
        )
    }

    signingConfigs {
        val keystorePath = releaseSigningProperty("ANDROID_KEYSTORE_FILE")
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = requireSigningProperty("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = requireSigningProperty("ANDROID_KEY_ALIAS")
                keyPassword = requireSigningProperty("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            val debugUrl = project.findProperty("DEBUG_SERVER_URL") as? String ?: "http://10.0.2.2:8000"
            buildConfigField("String", "DEBUG_SERVER_URL", "\"$debugUrl\"")
            // A debug build is signed with the debug key, so the system rejects
            // a released APK installed over it. -PUPDATE_CHECK_IN_DEBUG=true
            // turns the check back on while working on the updater itself.
            buildConfigField(
                "boolean",
                "UPDATE_ENABLED",
                (project.findProperty("UPDATE_CHECK_IN_DEBUG") as? String == "true").toString(),
            )
        }
        release {
            isMinifyEnabled = true
            // The updater downloads this APK over a phone connection, so the
            // unused-resource pass is worth the build time.
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            buildConfigField("String", "DEBUG_SERVER_URL", "\"\"")
            buildConfigField("boolean", "UPDATE_ENABLED", "true")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.toVersion(libs.versions.jvmTarget.get())
        targetCompatibility = JavaVersion.toVersion(libs.versions.jvmTarget.get())
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    androidResources {
        generateLocaleConfig = true
    }

    packaging {
        resources.excludes += "META-INF/versions/9/OSGI-INF/MANIFEST.MF"
    }
}

dependencies {
    implementation(project(":core"))
    implementation(project(":feature:onboarding"))
    implementation(project(":feature:planner"))
    implementation(project(":feature:chat"))
    implementation(project(":feature:tasks"))
    implementation(project(":feature:inbox"))
    implementation(project(":feature:search"))
    implementation(project(":feature:settings"))
    implementation(project(":feature:runs"))
    implementation(project(":feature:review"))
    implementation(project(":feature:progress"))
    implementation(project(":widget"))

    // Compose
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.core)
    implementation(libs.androidx.activity.compose)
    debugImplementation(libs.androidx.compose.ui.tooling)
    implementation(libs.androidx.compose.ui.tooling.preview)

    // Navigation
    implementation(libs.androidx.navigation.compose)

    // Hilt
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.androidx.hilt.navigation.compose)

    // Lifecycle
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.work.runtime.ktx)

    // AndroidX
    implementation(libs.androidx.core.ktx)

    // Testing
    testImplementation(libs.junit)
    testImplementation(libs.mockk)
    testImplementation(libs.turbine)
    testImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}
