plugins {
    id("com.android.application")
}

val repoRoot = rootProject.projectDir.parentFile
val stagedAssets = layout.buildDirectory.dir("generated/twodeers-assets")
val stageWebProject by tasks.registering(Sync::class) {
    from(repoRoot) {
        include("index.html")
        include("*.js")
        include("*.css")
        include("*.json")
        include("assets/**")
        exclude("android-apps/**", ".git/**", ".github/**", "tests/**")
    }
    into(stagedAssets.map { it.dir("site") })
}

android {
    namespace = "com.mercyy.twodeers"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.mercyy.twodeers"
        minSdk = 23
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    sourceSets.getByName("main").assets.srcDir(stagedAssets)
    buildTypes {
        debug { isDebuggable = true }
        release { isMinifyEnabled = false }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

tasks.named("preBuild").configure { dependsOn(stageWebProject) }

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
}
