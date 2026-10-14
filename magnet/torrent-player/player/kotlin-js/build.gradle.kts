plugins {
    kotlin("multiplatform") version "2.2.0"   // or the latest 2.x
}

repositories { mavenCentral() }

kotlin {
    js(IR) {
        browser {
            webpackTask { mainOutputFileName.set("kv-cache-kt.js") }
        }
        binaries.executable()
    }
}
