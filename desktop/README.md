# thredOS Desktop

This shell wraps the existing local-first thredOS app in Electron.

Current behavior:
- starts the local Next/Bun app on `http://127.0.0.1:3010`
- defaults the local workspace to `Documents/thredOS` unless `THREDOS_BASE_PATH` is set
- opens the workbench at `/app`
- routes external sign-in and billing flows through the system browser
- handles `thredos://` deep links back into the running desktop app

This is the launch foundation for `thredOS Desktop`.

It is intentionally minimal:
- no native menus yet
- no tray or background service yet

That keeps the app core intact while giving the product a real desktop shell.
