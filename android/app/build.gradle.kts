import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "top.anticraft.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "top.anticraft.app"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    // Java 与 Kotlin 的字节码目标必须一致（构建机是 JDK 24，Kotlin 2.0 不认识 24 会回退到 22）
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

// 纯原生壳（Activity + WebView），不依赖 AndroidX/Compose，包体更小
