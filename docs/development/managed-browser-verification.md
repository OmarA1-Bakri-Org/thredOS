# Verification with an existing managed Chromium

The standard verification commands support an existing absolute Chromium executable through `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. The default uses Playwright's bundled browser. Invalid selections fail before setup.

For the current managed Linux environment:

```bash
PLAYWRIGHT_BROWSER_LIB_DIR=/usr/lib/x86_64-linux-gnu \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
PLAYWRIGHT_VIDEO_MODE=off \
bun run verify:m1
```

`PLAYWRIGHT_VIDEO_MODE` accepts `off` or the default `retain-on-failure`. Disabling video allows verification when Playwright's separate FFmpeg binary is unavailable; failure traces and screenshots remain enabled. This selects an installed executable and changes recording only. Browser security, protocol activation, permissions and test assertions retain their existing behavior.

Record the selected Chromium version with the proof. This container provides Chromium 154.0.8037.57 and Playwright 1.58.2. Managed-browser `thredos://` activation and packaged native acceptance remain separate gates.

Owned verification servers bind to IPv4 loopback and use `http://localhost:<allocated-port>` as their browser and API origin. Playwright's Node API cookie jar sends Secure session cookies to `localhost`; with the numeric HTTP loopback address it omits them even when Chromium authenticates. The runner retains its allocated port and fresh workspace. Product cookie settings, server binding and release-live URL selection are unchanged.
