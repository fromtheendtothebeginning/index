package top.anticraft.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
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

/** 站点入口：直接落在校园服务（nginx 对深链返回 index.html，由前端路由接管） */
private const val START_URL = "https://anticraft.top/tools/campus-service"

/** 站内域名：用于区分「继续在 WebView 里打开」还是「交给系统浏览器」 */
private const val SITE_HOST = "anticraft.top"

/** logcat 标签：排查页面加载/脚本报错用 */
private const val TAG = "AnticraftWeb"

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

    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private lateinit var errorView: View

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            // debug 包开放 chrome://inspect / CDP 调试，便于排查页面渲染问题
            WebView.setWebContentsDebuggingEnabled(true)
        }
        setContentView(buildUi())
    }

    override fun onBackPressed() {
        // 先回退网页历史（子页面 → 校园服务主页），退到头再关 App
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    /** 默认进校园服务；带本站网址启动时用该网址（便于调试/直达某个页面） */
    private fun startUrl(): String {
        val uri = intent?.data ?: return START_URL
        val host = uri.host ?: return START_URL
        val mine = host == SITE_HOST || host.endsWith(".$SITE_HOST")
        return if (mine) uri.toString() else START_URL
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun buildUi(): View {
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

            webViewClient = object : WebViewClient() {
                // 站内链接留在 WebView（前端路由），站外链接交给系统浏览器
                override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                    val host = request.url.host ?: return false
                    if (host == SITE_HOST || host.endsWith(".$SITE_HOST")) return false
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                    return true
                }

                override fun onPageFinished(v: WebView, url: String?) {
                    Log.i(TAG, "page finished: $url")
                    v.evaluateJavascript(STRIP_BLANK_JS, null)
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
        return root
    }

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
