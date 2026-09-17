import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 36
    namespace = "studio.ccez.app"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "studio.ccez.app"
        // 26, not the Tauri default 24: the ML Kit GenAI Prompt API
        // requires API 26+ (below that the manifest merger fails).
        minSdk = 26
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    // Release signing from keystore.properties (written by CI from secrets).
    // Absent locally, so unsigned local builds keep working untouched.
    val keystorePropertiesFile = rootProject.file("keystore.properties")
    if (keystorePropertiesFile.exists()) {
        signingConfigs {
            create("release") {
                val keystoreProperties = Properties()
                keystoreProperties.load(FileInputStream(keystorePropertiesFile))
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["password"] as String
                storeFile = file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["password"] as String
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            signingConfigs.findByName("release")?.let { signingConfig = it }
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    // (jvmTarget moved to the top-level kotlin block: kotlinOptions
    // was removed in Kotlin 2.3. Target stays 1.8.)

    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

// kotlinOptions was removed in Kotlin 2.3: the JVM target rides the
// compilerOptions DSL. Stays 1.8 (the widest the shell's desugaring
// covers).
kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_1_8)
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    // On-device chat: ML Kit GenAI Prompt API over the AICore system app
    // (Gemini Nano — no bundled weights, no API key). Pinned to beta3,
    // NOT beta4: beta4's Kotlin 2.3 metadata needs kotlin-gradle-plugin
    // 2.3, which Tauri's own bundled script rejects (upstream
    // tauri#15694, unreleased). beta3 reads under the KGP 2.2.21 pinned
    // in ../build.gradle.kts.
    implementation("com.google.mlkit:genai-prompt:1.0.0-beta3")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")