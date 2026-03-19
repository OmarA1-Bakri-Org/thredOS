# thredOS Desktop

This shell wraps the existing local-first thredOS app in Electron.

Current behavior:
- starts the local Next/Bun app on `http://127.0.0.1:3010`
- forces `THREDOS_BASE_PATH` / `THREADOS_BASE_PATH` to the local workspace path
- opens the workbench at `/app`
- routes external sign-in and billing flows through the system browser

This is the launch foundation for `thredOS Desktop`.

It is intentionally minimal:
- no native menus yet
- no packaging config yet
- no deep-link activation handler in the renderer yet

That keeps the app core intact while giving the product a real desktop shell.
