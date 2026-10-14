package com.chanime.app

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

class MainActivity : Activity() {
    private lateinit var web: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        setContentView(web)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
        }
        web.addJavascriptInterface(Bridge(this, BASE_HOST), "KVNative")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == BASE_HOST) return false        // stay inside the app
                startActivity(Intent(Intent.ACTION_VIEW, request.url)) // everything else opens the browser
                return true
            }
        }

        if (Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        web.loadUrl(BASE_URL)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    companion object {
        const val BASE_URL = "https://YOUR-DOMAIN.example"   // <- your Chanime / player URL (https only)
        val BASE_HOST: String = Uri.parse(BASE_URL).host ?: ""
    }
}
