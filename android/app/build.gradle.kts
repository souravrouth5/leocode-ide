plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
}

val ndkVersionProp = (project.findProperty("leocode.ndk") as String?) ?: "28.2.13676358"

/**
 * Task 28: release builds take their version and signing key from the tag job.
 * A local build without these falls back to 0.1.0 / 2 and the debug key, which
 * is fine for a smoke test but never for a published release.
 */
fun envOrProp(env: String, prop: String): String? =
    (System.getenv(env) ?: (project.findProperty(prop) as String?))?.takeIf { it.isNotBlank() }

val versionNameOverride = envOrProp("LEOCODE_VERSION_NAME", "leocode.versionName")
val versionCodeRaw = envOrProp("LEOCODE_VERSION_CODE", "leocode.versionCode")
val versionCodeOverride = versionCodeRaw?.let {
    it.toIntOrNull() ?: throw GradleException(
        "LEOCODE_VERSION_CODE must be a positive integer, got '$it'"
    )
}
if (versionCodeOverride != null && versionCodeOverride <= 0) {
    throw GradleException("LEOCODE_VERSION_CODE must be positive, got $versionCodeOverride")
}
val updateManifestUrl = envOrProp("LEOCODE_UPDATE_URL", "leocode.updateUrl")
    ?: "https://github.com/souravrouth5/leocode-ide/releases/latest/download/release.json"
val releaseStoreFile = envOrProp("LEOCODE_RELEASE_STORE_FILE", "leocode.release.storeFile")
val releaseStorePassword =
    envOrProp("LEOCODE_RELEASE_STORE_PASSWORD", "leocode.release.storePassword")
val releaseKeyAlias = envOrProp("LEOCODE_RELEASE_KEY_ALIAS", "leocode.release.keyAlias")
val releaseKeyPassword =
    envOrProp("LEOCODE_RELEASE_KEY_PASSWORD", "leocode.release.keyPassword")
val requireReleaseSigning =
    envOrProp("LEOCODE_REQUIRE_RELEASE_SIGNING", "leocode.requireReleaseSigning") == "1"

if (requireReleaseSigning && releaseStoreFile == null) {
    throw GradleException(
        "LEOCODE_REQUIRE_RELEASE_SIGNING=1 but LEOCODE_RELEASE_STORE_FILE is not set"
    )
}

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
        versionCode = versionCodeOverride ?: 2
        versionName = versionNameOverride ?: "0.1.0"
        // Task 28: the signed release manifest URL; override for a mirror/demo.
        buildConfigField("String", "UPDATE_MANIFEST_URL", "\"$updateManifestUrl\"")

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

    signingConfigs {
        if (releaseStoreFile != null) {
            create("release") {
                storeFile = file(releaseStoreFile)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
                // v1+v2; the update check compares the certificate set, not the scheme.
                enableV1Signing = true
                enableV2Signing = true
            }
        }
    }

    buildTypes {
        release {
            // Task 28: R8 with keeps for the reflection-heavy dependencies.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig =
                signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
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
                // Both JGit jars ship an OSGi plugin.properties; only build tooling reads it.
                "plugin.properties",
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
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")

    // Phase 0D (declared now so versions are pinned early; exercised in Phase 0D)
    // D-016: JGit 5.13.x targets Java 8. JGit 6.x uses Java 11 library APIs that
    // are not on API 28 without core-library desugaring. Re-test 6.x on D1 before
    // any future major bump; see docs/decisions/README.md (D-016).
    implementation("org.eclipse.jgit:org.eclipse.jgit:5.13.3.202401111512-r")
    implementation("org.eclipse.jgit:org.eclipse.jgit.ssh.apache:5.13.3.202401111512-r") {
        // The POM pulls sshd-osgi, an uber-jar that already bundles sshd-core,
        // sshd-common and sshd-sftp. Keeping it next to the modular artifacts
        // below duplicates every class and the group17.prime resource, which
        // fails mergeDebugJavaResource. Use the modular jars at one version.
        exclude(group = "org.apache.sshd", module = "sshd-osgi")
    }
    implementation("org.apache.sshd:sshd-core:2.13.2")
    implementation("org.apache.sshd:sshd-sftp:2.13.2")
    implementation("org.bouncycastle:bcprov-jdk18on:1.78.1")
    implementation("org.bouncycastle:bcpkix-jdk18on:1.78.1")

    // Safe tar.gz extraction for runtime packages (SafeExtractor, Task 25).
    implementation("org.apache.commons:commons-compress:1.27.1")

    testImplementation("junit:junit:4.13.2")
}

/**
 * Task 28: the resolved release dependency set, for the CycloneDX SBOM.
 * `scripts/make-sbom.py` turns this plus `web/package-lock.json` into JSON.
 */
tasks.register("exportReleaseDependencies") {
    group = "release"
    description = "Write the resolved releaseRuntimeClasspath coordinates for the SBOM"
    doLast {
        val output = layout.buildDirectory.file("reports/release-dependencies.txt").get().asFile
        output.parentFile.mkdirs()
        val coordinates = configurations.getByName("releaseRuntimeClasspath")
            .resolvedConfiguration
            .resolvedArtifacts
            .map { it.moduleVersion.id.toString() }
            .distinct()
            .sorted()
        output.writeText(coordinates.joinToString("\n") + "\n")
        println("wrote ${coordinates.size} coordinates to ${output.absolutePath}")
    }
}

/**
 * Task 7: regenerate web/src/bridge/types.gen.ts from the Kotlin DTO descriptors.
 *
 * The generator lives in the unit-test source set so it can reuse the app's
 * compiled classes and serialization runtime without a second Gradle module.
 * CI runs this and `git diff --exit-code` to catch contract drift.
 */
tasks.register<JavaExec>("generateBridgeTypes") {
    group = "bridge"
    description = "Regenerate web/src/bridge/types.gen.ts from Kotlin serial descriptors"
    dependsOn("compileDebugUnitTestKotlin")

    val target = project.rootProject.projectDir.parentFile.resolve("web/src/bridge/types.gen.ts")
    val testRuntime = configurations.named("debugUnitTestRuntimeClasspath")

    classpath = files(
        layout.buildDirectory.dir("tmp/kotlin-classes/debugUnitTest"),
        testRuntime
    )
    mainClass.set("dev.leocode.bridge.types.GenerateBridgeTypesKt")
    args(target.absolutePath)

    inputs.files(fileTree("src/main/java/dev/leocode/bridge") { include("Contract.kt", "ErrorCode.kt") })
    outputs.file(target)

    doFirst {
        target.parentFile.mkdirs()
    }
}
