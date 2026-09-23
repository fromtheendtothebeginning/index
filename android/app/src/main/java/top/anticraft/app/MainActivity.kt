package top.anticraft.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import org.json.JSONTokener

/** 站点入口：直接落在校园服务（nginx 对深链返回 index.html，由前端路由接管） */
private const val START_URL = "https://anticraft.top/tools/campus-service"

/** 站内域名：用于区分「继续在 WebView 里打开」还是「交给系统浏览器」 */
private const val SITE_HOST = "anticraft.top"

/** logcat 标签：排查页面加载/脚本报错用 */
private const val TAG = "AnticraftWeb"

/** 站点浅色主题底色（CSS --bg-primary），页面加载完成前先用它铺底 */
private val DEFAULT_BACKGROUND = 0xFFF8F9FA.toInt()

/** 校园服务路径：在这里显示「信息门户」按钮 */
private const val CAMPUS_PATH = "/tools/campus-service"

/** 信息门户代理入口（后端把 portal.sit.edu.cn 反代到这里，流量走服务器校园网隧道） */
private const val PORTAL_PATH = "/api/sit"

/** 页面路由变化回传（SPA 的 pushState/replaceState/popstate 都不会触发 onPageFinished） */
private const val NAV_HOOK_JS = """
(function () {
  if (window.__anticraftNavHook) return;
  window.__anticraftNavHook = true;
  var send = function () {
    try { window.AnticraftHost.onUrl(location.href); } catch (e) {}
  };
  ['pushState', 'replaceState'].forEach(function (k) {
    var f = history[k];
    history[k] = function () { var r = f.apply(this, arguments); send(); return r; };
  });
  window.addEventListener('popstate', send);
  window.addEventListener('hashchange', send);
  send();
})();
"""

/**
 * 站内有不少 target="_blank" 的外链（项目仓库、LeetCode 等），WebView 默认会把它们丢掉、点了没反应。
 * 这里把 target 去掉改成同窗口跳转，再交给 shouldOverrideUrlLoading 分流；
 * SPA 重新渲染会加回 target，所以用 MutationObserver 兜住（rAF 去抖，避免每次 DOM 变更都全量查询）。
 */
private const val STRIP_BLANK_JS = """
(function () {
  if (window.__anticraftBlankFix) return;
  window.__anticraftBlankFix = true;
  var pending = false;
  var fix = function () {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      document.querySelectorAll('a[target="_blank"]').forEach(function (a) {
        a.removeAttribute('target');
        a.setAttribute('rel', 'noopener');
      });
    });
  };
  fix();
  new MutationObserver(fix).observe(document.documentElement, { childList: true, subtree: true });
})();
"""

class MainActivity : Activity() {

    private lateinit var root: FrameLayout
    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private lateinit var errorView: View
    private lateinit var portalButton: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            // debug 包开放 chrome://inspect / CDP 调试，便于排查页面渲染问题
            WebView.setWebContentsDebuggingEnabled(true)
        }
        root = buildUi()
        root.setBackgroundColor(DEFAULT_BACKGROUND)
        setContentView(root)
        applySystemBarInsets()
        setStatusBarIcons(darkBackground = false)
    }

    /**
     * 顶/底/左右留出系统栏（状态栏时间、手势条）空间。
     * targetSdk 35 在 Android 15+ 强制“边到边”，不自己处理 insets 的话页面内容会被状态栏和手势条压住。
     */
    private fun applySystemBarInsets() {
        root.setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val i = insets.getInsets(
                    WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                v.setPadding(i.left, i.top, i.right, i.bottom)
            } else {
                @Suppress("DEPRECATION")
                v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop,
                    insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }
    }

    /** 页面加载完取 <body> 实际背景色，铺到状态栏/手势条那两条，避免出现突兀的白边（深色主题下尤其明显） */
    private fun syncBackgroundFromPage(v: WebView) {
        v.evaluateJavascript("getComputedStyle(document.body).backgroundColor || ''") { res ->
            val color = parseCssColor(res) ?: return@evaluateJavascript
            root.setBackgroundColor(color)
            setStatusBarIcons(darkBackground = isDark(color))
        }
    }

    /** 解析 "rgb(r, g, b)" / "rgba(r, g, b, a)"；全透明的返回 null */
    private fun parseCssColor(jsResult: String?): Int? {
        val s = jsResult?.trim()?.trim('"') ?: return null
        val m = Regex("""rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)""").find(s) ?: return null
        val (r, g, b, a) = m.destructured
        if (a.isNotEmpty() && (a.toFloatOrNull() ?: 1f) == 0f) return null
        return Color.rgb(r.toInt(), g.toInt(), b.toInt())
    }

    private fun isDark(color: Int): Boolean =
        0.299 * Color.red(color) + 0.587 * Color.green(color) + 0.114 * Color.blue(color) < 128

    /** 深色背景 → 状态栏用浅色图标；浅色背景 → 深色图标（否则时间看不清） */
    private fun setStatusBarIcons(darkBackground: Boolean) {
        val lightBars = if (darkBackground) 0 else WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.setSystemBarsAppearance(
                lightBars, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS)
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = lightBars
        }
    }

    // ============================================================
    // 悬浮按钮：校园服务 ↔ 信息门户
    // ============================================================

    /** 只在「校园服务」和「信息门户」两类页面上出现，避免挡住站点其他内容 */
    private fun updatePortalButton(url: String?) {
        val u = url ?: return
        when {
            u.contains(PORTAL_PATH) -> {
                portalButton.text = getString(R.string.back_to_campus)
                portalButton.visibility = View.VISIBLE
            }
            u.contains(CAMPUS_PATH) -> {
                portalButton.text = getString(R.string.open_portal)
                portalButton.visibility = View.VISIBLE
            }
            else -> portalButton.visibility = View.GONE
        }
    }

    private fun onPortalButtonClick() {
        val current = webView.url ?: ""
        if (current.contains(PORTAL_PATH)) {
            webView.loadUrl(current.substringBefore(PORTAL_PATH) + CAMPUS_PATH)
            return
        }
        // 整页导航带不了 Authorization 头，所以把 JWT 交给后端换成 Cookie；
        // 用当前页面的 origin（不写死生产域名），本地联调同一套代码也能用
        webView.evaluateJavascript(
            "JSON.stringify({o:location.origin,t:localStorage.getItem('token')||''})"
        ) { res ->
            // evaluateJavascript 回传的是「JSON 字符串字面量」，要再解一层
            val payload = try {
                JSONObject(JSONTokener(res ?: "").nextValue() as String)
            } catch (e: Exception) {
                JSONObject()
            }
            val origin = payload.optString("o")
            val token = payload.optString("t")
            if (origin.isEmpty() || token.isEmpty()) {
                Toast.makeText(this, getString(R.string.need_login), Toast.LENGTH_SHORT).show()
                return@evaluateJavascript
            }
            // 门户的 JS 会被 WebView 长期缓存（含 V8 代码缓存），旧副本里是坏掉的资源地址，
            // 不清就会一直按旧地址请求（403 → 页面自己退出），所以进门户前整份清掉。
            // 站点登录态在 localStorage 而门户不用 localStorage（已核实），故只清缓存与 Cookie。
            webView.clearCache(true)
            CookieManager.getInstance().removeAllCookies(null)
            CookieManager.getInstance().flush()
            webView.loadUrl("$origin$PORTAL_PATH/?t=$token")
        }
    }

    /** 站点 SPA 的地址变化通过 JS 桥回传到界面（不用轮询） */
    private inner class NavBridge {
        @JavascriptInterface
        fun onUrl(url: String?) {
            runOnUiThread { updatePortalButton(url) }
        }
    }

    override fun onBackPressed() {
        // 先回退网页历史（子页面 → 校园服务主页），退到头再关 App
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    /** 是否本站地址；debug 包额外放行本机联调地址（模拟器经 10.0.2.2 访问宿主） */
    private fun isSiteHost(host: String?): Boolean {
        if (host == null) return false
        if (host == SITE_HOST || host.endsWith(".$SITE_HOST")) return true
        val debuggable = applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
        return debuggable && (host == "10.0.2.2" || host == "localhost" || host == "127.0.0.1")
    }

    /**
     * 校园内网门户（portal/my.sit.edu.cn）在手机上进不去，交给服务器反代。
     * CAS 登录后会把浏览器送回**真实**门户地址（它的 OAuth 回调有白名单校验，不能改写），
     * 所以在这里把这类导航映射到代理路径上。
     */
    private fun portalProxyFor(url: android.net.Uri): String? {
        val host = url.host ?: return null
        if (host != "portal.sit.edu.cn" && host != "my.sit.edu.cn") return null
        val origin = webView?.url
            ?.let { runCatching { android.net.Uri.parse(it) }.getOrNull() }
            ?.let { "${it.scheme}://${it.authority}" }
            ?: ("https://" + SITE_HOST)
        val path = url.encodedPath ?: "/"
        val query = url.encodedQuery?.let { "?$it" } ?: ""
        return origin + PORTAL_PATH + path + query
    }

    /** 默认进校园服务；带本站网址启动时用该网址（便于调试/直达某个页面） */
    private fun startUrl(): String {
        val uri = intent?.data ?: return START_URL
        return if (isSiteHost(uri.host)) uri.toString() else START_URL
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun buildUi(): FrameLayout {
        val root = FrameLayout(this)

        progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            visibility = View.GONE
        }
        root.addView(progressBar, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 6, android.view.Gravity.TOP))

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true   // 站点把登录 token 存在 localStorage
            settings.setSupportMultipleWindows(false)

            addJavascriptInterface(NavBridge(), "AnticraftHost")

            webViewClient = object : WebViewClient() {
                // 站内链接留在 WebView（前端路由），站外链接交给系统浏览器
                override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                    if (isSiteHost(request.url.host)) return false
                    // 登录后被 CAS 送回真实门户地址 → 映射到服务器反代
                    portalProxyFor(request.url)?.let { proxied ->
                        Log.i(TAG, "portal host mapped: ${request.url.host} -> proxy")
                        v.loadUrl(proxied)
                        return true
                    }
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                    return true
                }

                override fun onPageFinished(v: WebView, url: String?) {
                    Log.i(TAG, "page finished: $url")
                    v.evaluateJavascript(STRIP_BLANK_JS, null)
                    v.evaluateJavascript(NAV_HOOK_JS, null)
                    syncBackgroundFromPage(v)
                    updatePortalButton(url)
                }

                override fun onPageStarted(v: WebView?, url: String?, favicon: Bitmap?) {
                    showError(false)
                }

                override fun onReceivedError(
                    v: WebView, request: WebResourceRequest, error: WebResourceError,
                ) {
                    if (request.isForMainFrame) {
                        Log.e(TAG, "load error ${error.errorCode} ${request.url}")
                        showError(true)
                    }
                }

                // 主文档 4xx/5xx（含 JS 资源被拦）不会走 onReceivedError，必须单独处理，
                // 否则失败时只剩一张空白页
                override fun onReceivedHttpError(
                    v: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse,
                ) {
                    Log.e(TAG, "http ${errorResponse.statusCode} ${request.url}")
                    if (request.isForMainFrame) showError(true)
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onProgressChanged(v: WebView?, newProgress: Int) {
                    progressBar.progress = newProgress
                    progressBar.visibility = if (newProgress in 1..99) View.VISIBLE else View.GONE
                }

                override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                    if (msg.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                        Log.e(TAG, "console: ${msg.message()} (${msg.sourceId()}:${msg.lineNumber()})")
                    }
                    return true
                }
            }

            // 必须等控件完成布局（有真实宽高）再加载：WebView 高度还是 0 时加载，
            // Chromium 会把布局视口钉在 0，vh/dvh 等视口单位全变 0，
            // 靠 min-height:100vh 撑开的页面（如登录页）会整页塌陷成白的。
            var loaded = false
            val self = this
            addOnLayoutChangeListener(object : View.OnLayoutChangeListener {
                override fun onLayoutChange(
                    v: View, left: Int, top: Int, right: Int, bottom: Int,
                    oldLeft: Int, oldTop: Int, oldRight: Int, oldBottom: Int,
                ) {
                    if (!loaded && v.width > 0 && v.height > 0) {
                        loaded = true
                        v.removeOnLayoutChangeListener(this)
                        self.loadUrl(startUrl())
                    }
                }
            })
        }
        root.addView(webView, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        errorView = buildErrorView().apply { visibility = View.GONE }
        root.addView(errorView, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        // 悬浮按钮：校园服务页显示「信息门户」，门户页显示「返回校园服务」
        portalButton = TextView(this).apply {
            text = getString(R.string.open_portal)
            setTextColor(Color.WHITE)
            textSize = 14f
            setPadding(dp(18), dp(10), dp(18), dp(10))
            background = GradientDrawable().apply {
                cornerRadius = dp(22).toFloat()
                setColor(0xFF6C5CE7.toInt())
            }
            elevation = dp(6).toFloat()
            visibility = View.GONE
            setOnClickListener { onPortalButtonClick() }
        }
        root.addView(portalButton, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            android.view.Gravity.BOTTOM or android.view.Gravity.END).apply {
            setMargins(dp(16), dp(16), dp(16), dp(20))
        })
        return root
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun buildErrorView(): View {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = android.view.Gravity.CENTER
            setPadding(64, 64, 64, 64)
            setBackgroundColor(0xFFF7F7FB.toInt())
        }
        box.addView(TextView(this).apply {
            text = getString(R.string.load_failed_title)
            textSize = 18f
        })
        box.addView(TextView(this).apply {
            text = getString(R.string.load_failed_hint)
            textSize = 14f
            setPadding(0, 12, 0, 0)
        })
        box.addView(Button(this).apply {
            text = getString(R.string.reload)
            setOnClickListener {
                showError(false)
                webView.reload()
            }
        }, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            topMargin = 24
        })
        return box
    }

    private fun showError(show: Boolean) {
        errorView.visibility = if (show) View.VISIBLE else View.GONE
    }
}
