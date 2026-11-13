import java.net.URLDecoder

plugins {
    id("com.android.application")
}

val repoRoot = rootProject.projectDir.parentFile
val stagedAssets = layout.buildDirectory.dir("generated/twodeers-assets")

// The checked-in 352-item manifest and its finished image files are the single
// source of truth. APK builds must not depend on absent source ZIPs or Python.
val verifyBuiltinStickers by tasks.registering {
    group = "verification"
    description = "Verify all 352 checked-in offline built-in sticker assets."
    inputs.file(repoRoot.resolve("assets/builtin-stickers/manifest.json"))
    inputs.dir(repoRoot.resolve("assets/builtin-stickers"))
    doLast {
        val manifestFile = repoRoot.resolve("assets/builtin-stickers/manifest.json")
        check(manifestFile.isFile) { "Missing built-in sticker manifest: $manifestFile" }
        val parsed = groovy.json.JsonSlurper().parse(manifestFile) as Map<*, *>
        val items = parsed["items"] as? List<*> ?: error("Built-in sticker manifest has no items array")
        check(parsed["version"] == 1) { "Unsupported built-in sticker manifest version" }
        check(parsed["totalCount"] == 352 && items.size == 352) {
            "Built-in sticker manifest must contain exactly 352 items; found ${items.size}"
        }
        val missing = mutableListOf<String>()
        val invalid = mutableListOf<String>()
        items.forEach { raw ->
            val item = raw as? Map<*, *> ?: run { invalid += "non-object item"; return@forEach }
            val url = item["assetUrl"] as? String
            if (url.isNullOrBlank() || !url.startsWith("assets/builtin-stickers/")) {
                invalid += "invalid assetUrl: ${url ?: "(missing)"}"
                return@forEach
            }
            val relative: String = URLDecoder.decode(url, Charsets.UTF_8.name())
            val asset = repoRoot.resolve(relative)
            if (!asset.isFile) missing.add(relative)
            else {
                val expected = (item["size"] as? Number)?.toLong()
                if (expected != null && expected != asset.length()) invalid.add("size mismatch: $relative")
            }
        }
        check(invalid.isEmpty()) { "Invalid built-in sticker manifest entries: ${invalid.take(12).joinToString()}" }
        check(missing.isEmpty()) { "Missing built-in sticker assets: ${missing.take(12).joinToString()}" }
    }
}

val stageWebProject by tasks.registering(Sync::class) {
    dependsOn(verifyBuiltinStickers)
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
        applicationId = "com.mercyy.beibeilu"
        minSdk = 23
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    flavorDimensions += "instance"
    productFlavors {
        create("beibeilu") {
            dimension = "instance"
            resValue("string", "app_name", "贝贝鹿")
        }
        create("lu1") {
            dimension = "instance"
            applicationIdSuffix = ".lu1"
            resValue("string", "app_name", "传讯1")
        }
        create("lu2") {
            dimension = "instance"
            applicationIdSuffix = ".lu2"
            resValue("string", "app_name", "传讯2")
        }
        create("lu3") {
            dimension = "instance"
            applicationIdSuffix = ".lu3"
            resValue("string", "app_name", "传讯3")
        }
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
