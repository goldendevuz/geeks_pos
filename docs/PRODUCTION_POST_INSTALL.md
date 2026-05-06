# Geeks POS — production build & post-install

## One-shot production build (Windows)

From repo root (PowerShell):

```powershell
.\scripts\build-production.ps1
```

Optional:

- `-SkipNpmInstall` — if `frontend/node_modules` is already fresh.
- `-SkipClean` — incremental (not recommended for release).
- `-SkipRustTargetOnClean` with full clean via `.\scripts\clean-build-artifacts.ps1 -SkipRustTarget` — faster clean, then run build-production with `-SkipClean` if you manage clean yourself.

Artifacts:

- **Installers**: `src-tauri/target/release/bundle/` (MSI / NSIS / etc. per `tauri.conf.json` `bundle.targets`).
- **Sidecar**: built to `backend/dist/geeks_pos_backend.exe` plus `geeks_pos_backend-<host-triple>.exe` for Tauri `externalBin`; copies also under `src-tauri/bin/` for convenience.

## Backend sidecar (PyInstaller)

Script: `backend/scripts/build_sidecar.ps1`

- **`--noconsole`**: no extra console window for the packaged API.
- **`--collect-all escpos`**: full `python-escpos` (`escpos` import name) including `capabilities.json`.
- **DEBUG**: Tauri release spawns sidecar with `DJANGO_DEBUG=0`. Packaged `run_waitress.py` also defaults `DJANGO_DEBUG=0` when `sys.frozen`.

## Bundle identifier

`tauri.conf.json` uses `uz.geeks.pos`. Agar ilgari `com.geeks.pos` bilan MSI chiqarilgan bo‘lsa, Windows yangi mahsulot sifatida ko‘rishi mumkin — yangilash strategiyasini shunga moslang.

## Tauri / UI defaults

- **Window**: default **1366×768**, resizable, not fullscreen, not always-on-top.
- **Kiosk** (fullscreen, always-on-top, non-resizable): set environment variable `GEEKS_POS_KIOSK=1` for the desktop shortcut or process (e.g. monoblok lock-down).

## Data directory & SQLite

On first run the app creates a writable tree (see `backend/config/settings.py` and `src-tauri/src/main.rs`):

1. `%APPDATA%\GeeksPOS` (preferred)
2. then `%LOCALAPPDATA%\GeeksPOS`
3. then `%USERPROFILE%\GeeksPOS`

Database file: **`%APPDATA%\GeeksPOS\db.sqlite3`** (when `APPDATA` is set). Logs: `%APPDATA%\GeeksPOS\logs\`.

**Installer must not** ship `backend/db.sqlite3` from the repo; the build scripts fail if it exists.

## Firewall (post-install)

Tauri **1.x** NSIS konfiguratsiyasida `installer_hooks` yo‘q, shuning uchun firewall qoidasi **o‘rnatish jarayonining o‘zida** avtomatik qo‘shilmaydi (buning uchun maxsus NSIS shablon yoki Tauri 2+ kerak).

**O‘rnatgandan keyin** (bir marta, Administrator):

1. **Oson yo‘l:** o‘rnatilgan ilova papkasidagi `resources` ichida **`add-firewall-rule-admin.bat`** ni o‘ng tugma → **Run as administrator** (yoki oddiy ishga tushirib UAC ruxsatini bering). U yonidagi **`add-firewall-rule.ps1`** ni admin PowerShell bilan ishga tushiradi.
2. **Yoki** repodan / Administrator PowerShell:
   ```powershell
   & "C:\Program Files\GEEKS POS\resources\add-firewall-rule.ps1"
   ```
   (yo‘l o‘rnatish joyingizga mos; skript o‘zi yon-atrofdagi `geeks_pos_backend*.exe` ni qidiradi.)
3. **Aniq exe bo‘lsa:**
   ```powershell
   .\add-firewall-rule.ps1 -ProgramPath "C:\Program Files\GEEKS POS\geeks_pos_backend-x86_64-pc-windows-msvc.exe"
   ```

`tauri build` paytida yuqoridagi ikki fayl **`resources`** orqali installer ichiga qo‘shiladi (`bundle.resources`).

Backend asosan **127.0.0.1** da ishlaydi; firewall qoidasi qat’iy korporativ siyosatlar yoki kelajakdagi localhost cheklovlari uchun foydali.

---

## Post-install checklist (monoblok)

1. **Install** the MSI or setup from `src-tauri/target/release/bundle/`.
2. **WebView2**: ensure [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) is installed (first launch checks this).
3. **First launch**: confirm `%APPDATA%\GeeksPOS\` exists and `db.sqlite3` is created after migrations.
4. **License**: set `LICENSE_API_BASE_URL`, `LICENSE_AUTH_TOKEN`, `LICENSE_CLIENT_API_KEY` in deployment docs / env as applicable (see backend `.env` examples).
5. **Printers**: configure receipt/label printers in Settings; test print from admin.
6. **Firewall** (ixtiyoriy): o‘rnatishdan keyin `resources\add-firewall-rule-admin.bat` (Run as administrator) yoki `resources\add-firewall-rule.ps1` ni admin PowerShelldan ishga tushiring.
7. **Kiosk vs windowed**: use default windowed 1366×768, or set `GEEKS_POS_KIOSK=1` on the shortcut for fullscreen kiosk.
8. **Backup**: schedule or document `python scripts/backup_sqlite.py` for `%APPDATA%\GeeksPOS\db.sqlite3`.

## Runtime .env standard (production)

Primary runtime location:

- `%APPDATA%\GeeksPOS\.env`

Minimal required keys for activation:

```env
LICENSE_API_BASE_URL=https://your-license-host.example
LICENSE_AUTH_TOKEN=your_token
LICENSE_CLIENT_API_KEY=your_client_key
```

Also accepted (fallback names): `LICENSE_SERVER_URL`, `LICENSE_URL`, `LICENSE_TOKEN`, `LICENSE_API_TOKEN`, `LICENSE_CLIENT_KEY`, `CLIENT_API_KEY`.

### Activation troubleshooting (operator)

1. Close app completely.
2. Ensure no stale backend process:
   - `taskkill /F /IM "geeks_pos_backend.exe" /T`
3. Verify `%APPDATA%\GeeksPOS\.env` exists and contains non-empty license keys above.
4. Start app and retry activation.
5. If still failing, check `%APPDATA%\GeeksPOS\logs\backend.log` for `LICENSE_API_BASE_URL` / upstream errors.

## Release gate (must pass before shipping installer)

### Technical gate

From repo root:

```powershell
npm run build --prefix frontend
python -m py_compile backend/config/settings.py backend/printing/receipt.py backend/printing/views.py backend/sales/views.py
cargo check --manifest-path src-tauri/Cargo.toml
powershell -ExecutionPolicy Bypass -File .\backend\scripts\build_sidecar.ps1
```

### Business smoke gate

- Cashier: complete sale from POS.
- Cashier/Admin: sale appears in sales history (cashier default today, date filters work with from/to).
- Receipt print: toast reports queue submission and physical print works.
- Label print: still works after receipt print.
- Activation: success with runtime `.env`.
- Restart app 2-3 times: only one backend sidecar process remains running.
