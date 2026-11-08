plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val ndkVersionProp = (project.findProperty("leocode.ndk") as String?) ?: "27.0.12077973"

android {
    namespace = "dev.leocode"
    compileSdk = 34
    ndkVersion = ndkVersionProp

    defaultConfig {
        // D-003: fixed forever. Changing this invalidates every runtime package.
        applicationId = "dev.leocode"
        // D-002: targetSdk 28 is required to execve() downloaded binaries.
        minSdk = 28
        targetSdk = 28
        versionCode = 1
        versionName = "0.0.1-phase0"

        externalNativeBuild {
            cmake {
                arguments += listOf("-DANDROID_STL=c++_static")
                cFlags += listOf("-Wall", "-Wextra")
            }
        }
        ndk {
            abiFilters += listOf("arm64-v8a")
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug") // phase 0 only
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
    }

    // Keep .so files extracted so native helpers can be exec'd from nativeLibraryDir
    // on Android 10+ if that workaround is ever needed.
    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
        resources {
            // Bouncy Castle ships multi-release jars; AGP cannot merge their OSGI manifests.
            excludes += listOf(
                "META-INF/versions/9/OSGI-INF/MANIFEST.MF",
                "META-INF/versions/*/module-info.class",
                "META-INF/*.SF",
                "META-INF/*.DSA",
                "META-INF/*.RSA",
                "META-INF/DEPENDENCIES",
                "META-INF/LICENSE*",
                "META-INF/NOTICE*"
            )
        }
    }

    lint {
        warningsAsErrors = false
        // targetSdk 28 intentionally trips ExpiredTargetSdkVersion; do not fail the build.
        disable += listOf("ExpiredTargetSdkVersion")
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.webkit:webkit:1.11.0")

    // Phase 0D (declared now so versions are pinned early; exercised in Phase 0D)
    implementation("org.eclipse.jgit:org.eclipse.jgit:6.10.0.202406032230-r")
    implementation("org.apache.sshd:sshd-core:2.13.2")
    implementation("org.bouncycastle:bcprov-jdk18on:1.78.1")
    implementation("org.bouncycastle:bcpkix-jdk18on:1.78.1")

    testImplementation("junit:junit:4.13.2")
}
