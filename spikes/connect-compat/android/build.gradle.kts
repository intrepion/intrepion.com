buildscript {
    dependencies {
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.21")
    }
}

plugins {
    id("com.android.application") version "9.3.1"
}

android {
    namespace = "com.intrepion.spike"
    compileSdk = 37
    buildToolsVersion = "36.0.0"

    defaultConfig {
        applicationId = "com.intrepion.spike"
        minSdk = 28
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    sourceSets {
        getByName("main") {
            java.srcDirs("generated")
            kotlin.srcDirs("src/main/kotlin", "generated")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        languageVersion.set(org.jetbrains.kotlin.gradle.dsl.KotlinVersion.KOTLIN_2_2)
        apiVersion.set(org.jetbrains.kotlin.gradle.dsl.KotlinVersion.KOTLIN_2_2)
    }
}

dependencies {
    implementation("com.connectrpc:connect-kotlin:0.10.0")
    implementation("com.connectrpc:connect-kotlin-okhttp:0.10.0")
    implementation("com.connectrpc:connect-kotlin-google-java-ext:0.10.0")
    implementation("com.google.protobuf:protobuf-java:4.36.2")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
}
