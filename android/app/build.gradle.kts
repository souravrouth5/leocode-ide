plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
}

val ndkVersionProp = (project.findProperty("leocode.ndk") as String?) ?: "28.2.13676358"

// Task 3 T2c control build only, to document the Android 10 W^X block:
//   ./gradlew assembleDebug -Pleocode.controlTargetSdk=29
// D-002: shipped builds stay at targetSdk 28. Never raise this property for a release.
val controlTargetSdk = (project.findProperty("leocode.controlTargetSdk") as String?)?.toInt()

android {
    namespace = "dev.leocode"
    compileSdk = 34
    ndkVersion = ndkVersionProp

    defaultConfig {
        // D-003: fixed forever. Changing this invalidates every runtime package.
        applicationId = "dev.leocode"
        // D-002: targetSdk 28 is required to execve() downloaded binaries.
        minSdk = 28
        targetSdk = controlTargetSdk ?: 28
        versionCode = 2
        versionName = "0.1.0"

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
        // Known, accepted findings are recorded here; anything new fails CI.
        baseline = file("lint-baseline.xml")
        // targetSdk 28 intentionally trips ExpiredTargetSdkVersion; do not fail the build.
        disable += listOf("ExpiredTargetSdkVersion")
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")

    // Phase 0D (declared now so versions are pinned early; exercised in Phase 0D)
    implementation("org.eclipse.jgit:org.eclipse.jgit:6.10.0.202406032230-r")
    implementation("org.apache.sshd:sshd-core:2.13.2")
    implementation("org.bouncycastle:bcprov-jdk18on:1.78.1")
    implementation("org.bouncycastle:bcpkix-jdk18on:1.78.1")

    testImplementation("junit:junit:4.13.2")
}
