import "@/index.css";
import Head from "next/head";

// ──────────────────────────────────────────────────────────────────────────
// Dev-only workaround for a Next.js 16.2.4 bug that causes an endless
// "the app keeps refreshing" loop.
//
// This project is a client-only SPA (react-router) mounted via a Pages-Router
// catch-all with `next/dynamic({ ssr: false })`. In dev, Next also runs the
// *app-router* hot-reloader. On HMR messages it calls
// `publicAppRouterInstance.hmrRefresh()`, which dispatches an app-router action.
// Because no app-router route ever mounts, the app-router action queue is never
// created and the dispatch throws:
//   "Internal Next.js error: Router action dispatched before initialization."
// Next treats that as a runtime error, so the next HMR ping forces a full page
// reload — which reconnects and throws again, looping forever.
//
// Two layers of defense, both dev-only and stripped from production builds:
//   1. Wrap `window.next.router.hmrRefresh` (the very object the hot-reloader
//      invokes) to swallow that specific init error — an app-router refresh is
//      a no-op for this SPA. We re-apply it on a permanent interval because HMR
//      re-evaluates the app-router module on rebuilds, replacing the object.
//   2. A capturing global error / rejection listener that neutralizes the same
//      error in case it slips through before the wrapper is (re)applied.
// ──────────────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
  const INIT_ERROR = "Router action dispatched before initialization";

  const isInitError = (value) =>
    !!value && String(value.message || value || "").includes(INIT_ERROR);

  // Layer 1: keep hmrRefresh patched on the live app-router instance.
  const patchHmrRefresh = () => {
    const router = window.next && window.next.router;
    const fn = router && router.hmrRefresh;
    if (typeof fn !== "function" || fn.__payrollphPatched) return;

    const safeHmrRefresh = function patchedHmrRefresh(...args) {
      try {
        return fn.apply(this, args);
      } catch (error) {
        if (isInitError(error)) return undefined;
        throw error;
      }
    };
    safeHmrRefresh.__payrollphPatched = true;

    try {
      router.hmrRefresh = safeHmrRefresh;
    } catch {
      /* router object is frozen — fall back to layer 2 */
    }
  };

  patchHmrRefresh();
  // Never cleared: HMR rebuilds reset window.next.router to a fresh object, so
  // we must keep re-wrapping it. The interval is trivially cheap in dev only.
  setInterval(patchHmrRefresh, 200);

  // Layer 2: stop the specific error from being treated as a runtime error,
  // which is what triggers Fast Refresh's full-reload loop. Scoped strictly to
  // the exact init-error message so real errors still surface normally.
  window.addEventListener(
    "error",
    (event) => {
      if (isInitError(event.error)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  window.addEventListener(
    "unhandledrejection",
    (event) => {
      if (isInitError(event.reason)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
}

export default function PayrollPhApp({ Component, pageProps }) {
  return (
    <>
      <Head>
        <title>PayrollPH Employee Portal</title>
        <meta name="application-name" content="PayrollPH Employee Portal" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Employee Portal" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="theme-color" content="#2563eb" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/icons/employee-portal-icon.svg" type="image/svg+xml" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
