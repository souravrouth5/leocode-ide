# Task 28: R8 keeps for the reflection-heavy dependencies.
#
# JGit, Apache SSHD and Bouncy Castle discover implementations through
# reflection and service files, and kotlinx.serialization generates a
# `$$serializer` per DTO. These rules are intentionally broad: a release that
# installs but fails on the first Git operation is worse than a slightly larger
# APK. The device smoke test (scripts/smoke.sh) is the final check.

-keepattributes Signature, InnerClasses, EnclosingMethod, *Annotation*, Exceptions

# ------------------------------------------------------ kotlinx.serialization
-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class dev.leocode.**$$serializer { *; }
-keepclassmembers class dev.leocode.** {
    *** Companion;
}
-keepclasseswithmembers class dev.leocode.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keepclassmembers enum dev.leocode.** {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# --------------------------------------------------------------- Git / SSH
-keep class org.eclipse.jgit.** { *; }
-keep class org.apache.sshd.** { *; }
-keep class org.slf4j.** { *; }
# EdDSA provider used by the SSH key code; registered and loaded by name.
-keep class net.i2p.crypto.eddsa.** { *; }
-dontwarn org.eclipse.jgit.**
-dontwarn org.apache.sshd.**
-dontwarn org.slf4j.**
-dontwarn net.i2p.crypto.eddsa.**

# ---------------------------------------------------------- Bouncy Castle
-keep class org.bouncycastle.** { *; }
-dontwarn org.bouncycastle.**

# Optional JDK/GSS classes referenced by SSHD but absent on Android.
-dontwarn javax.naming.**
-dontwarn javax.security.**
-dontwarn org.ietf.jgss.**
-dontwarn java.awt.**
-dontwarn sun.security.**

# Keep the FileProvider and the installer entry points named in the manifest.
-keep class androidx.core.content.FileProvider { *; }
