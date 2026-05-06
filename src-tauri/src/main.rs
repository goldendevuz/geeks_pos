// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use std::fs;
use std::fs::File;
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{LogicalSize, Manager};

#[cfg(windows)]
use std::ffi::OsStr;
#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;

#[cfg(windows)]
use windows_sys::Win32::Foundation::{GetLastError, ERROR_INSUFFICIENT_BUFFER};
#[cfg(windows)]
use windows_sys::Win32::Graphics::Printing::{
    ClosePrinter, EndDocPrinter, EndPagePrinter, EnumPrintersW, GetDefaultPrinterW, OpenPrinterW,
    StartDocPrinterW, StartPagePrinter, WritePrinter, DOC_INFO_1W, PRINTER_INFO_4W,
    PRINTER_ACCESS_USE, PRINTER_DEFAULTSW,
};
#[cfg(windows)]
use windows_sys::Win32::System::Power::{
    SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
};

/// Serialize RAW jobs to the Windows spooler (reduces USB "port busy" / driver races when switching printers).
#[cfg(windows)]
static RAW_PRINT_MUTEX: Mutex<()> = Mutex::new(());

struct BackendState {
    child: Mutex<Option<Child>>,
    port: Mutex<u16>,
    /// Set when backend failed to start; cleared on success. UI can read via `get_backend_bootstrap_error`.
    bootstrap_error: Mutex<Option<String>>,
}

fn backend_candidate_names() -> Vec<&'static str> {
    #[cfg(windows)]
    {
        vec![
            "geeks_pos_backend.exe",
            "geeks_pos_backend-x86_64-pc-windows-msvc.exe",
            "geeks_pos_backend-i686-pc-windows-msvc.exe",
        ]
    }
    #[cfg(not(windows))]
    {
        vec!["geeks_pos_backend"]
    }
}

fn app_home_dir() -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        let p = PathBuf::from(appdata).join("GeeksPOS");
        let _ = fs::create_dir_all(&p);
        return p;
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let p = PathBuf::from(local).join("GeeksPOS");
        let _ = fs::create_dir_all(&p);
        return p;
    }
    if let Ok(home) = std::env::var("USERPROFILE") {
        let p = PathBuf::from(home).join("GeeksPOS");
        let _ = fs::create_dir_all(&p);
        return p;
    }
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".geeks_pos")
}

fn backend_boot_log_path() -> PathBuf {
    app_home_dir().join("logs").join("backend_boot.log")
}

/// Read backend_boot.log for support hints (e.g. AppRegistryNotReady).
fn boot_log_failure_hint() -> Option<String> {
    let path = backend_boot_log_path();
    let mut f = File::open(path).ok()?;
    let mut s = String::new();
    f.read_to_string(&mut s).ok()?;
    let tail = if s.len() > 16_384 {
        &s[s.len() - 16_384..]
    } else {
        &s
    };
    if tail.contains("AppRegistryNotReady") {
        return Some(
            "Django bootstrap xatosi (AppRegistryNotReady). Migratsiya django.setup()dan keyin ishlashi kerak — backend/sidecar yangilang.".to_string(),
        );
    }
    if tail.contains("BOOTSTRAP_FAIL") || tail.contains("Traceback") {
        return Some("backend_boot.log da Traceback bor — migratsiya/bootstrap xatosi bo‘lishi mumkin.".to_string());
    }
    None
}

fn append_log_line(level: &str, message: &str) {
    let dir = app_home_dir().join("logs");
    let _ = fs::create_dir_all(&dir);
    let file = dir.join("app.log");
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let line = format!("[{ts}] [{level}] {message}\n");
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(file) {
        let _ = f.write_all(line.as_bytes());
    }
}

fn runtime_secret_key() -> String {
    if let Ok(v) = std::env::var("DJANGO_SECRET_KEY") {
        let trimmed = v.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    let path = app_home_dir().join("runtime_secret.key");
    if let Ok(existing) = fs::read_to_string(&path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    let generated = format!(
        "geekspos-{}-{}",
        uuid::Uuid::new_v4(),
        uuid::Uuid::new_v4()
    );
    let _ = fs::write(&path, &generated);
    generated
}

fn internal_flush_key() -> String {
    std::env::var("INTERNAL_FLUSH_KEY").unwrap_or_else(|_| {
        if cfg!(debug_assertions) {
            "dev-internal-flush-key".to_string()
        } else {
            String::new()
        }
    })
}

fn post_notification_flush(port: u16) {
    let key = internal_flush_key();
    if key.is_empty() {
        return;
    }
    let body = r#"{"limit":50}"#;
    let req = format!(
        "POST /api/integrations/notification-queue/flush/ HTTP/1.1\r\n\
         Host: 127.0.0.1:{port}\r\n\
         X-Internal-Key: {key}\r\n\
         Content-Type: application/json\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\r\n\
         {body}",
        body.len()
    );
    if let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) {
        let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
        let _ = stream.set_read_timeout(Some(Duration::from_secs(15)));
        let _ = stream.write_all(req.as_bytes());
        let mut buf = [0u8; 512];
        let _ = stream.read(&mut buf);
    }
}

fn spawn_notification_flush_loop(app: tauri::AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(300));
        let state = app.state::<BackendState>();
        let port = state.port.lock().map(|p| *p).unwrap_or(8000);
        post_notification_flush(port);
    });
}

#[cfg(windows)]
fn enable_windows_autostart() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| format!("current_exe failed: {e}"))?;
    let exe_str = exe
        .to_str()
        .ok_or_else(|| "Executable path is not valid UTF-8".to_string())?;
    let status = Command::new("reg")
        .args([
            "add",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
            "/v",
            "GeeksPOS",
            "/t",
            "REG_SZ",
            "/d",
            exe_str,
            "/f",
        ])
        .status()
        .map_err(|e| format!("reg add failed: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("reg add returned non-zero exit code".to_string())
    }
}

#[cfg(windows)]
fn enable_windows_task_autostart() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| format!("current_exe failed: {e}"))?;
    let exe_str = exe
        .to_str()
        .ok_or_else(|| "Executable path is not valid UTF-8".to_string())?;
    let task_name = "GeeksPOS_Autostart";
    let status = Command::new("schtasks")
        .args([
            "/Create",
            "/F",
            "/SC",
            "ONLOGON",
            "/RL",
            "HIGHEST",
            "/TN",
            task_name,
            "/TR",
            exe_str,
        ])
        .status()
        .map_err(|e| format!("schtasks create failed: {e}"))?;
    if status.success() {
        return Ok(());
    }

    // Some POS users don't have rights for HIGHEST. Retry with LIMITED.
    let fallback = Command::new("schtasks")
        .args([
            "/Create",
            "/F",
            "/SC",
            "ONLOGON",
            "/RL",
            "LIMITED",
            "/TN",
            task_name,
            "/TR",
            exe_str,
        ])
        .status()
        .map_err(|e| format!("schtasks create fallback failed: {e}"))?;
    if fallback.success() {
        Ok(())
    } else {
        Err("schtasks returned non-zero exit code".to_string())
    }
}

#[cfg(not(windows))]
fn enable_windows_autostart() -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
fn enable_windows_task_autostart() -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
fn disable_windows_autostart_entries() {
    let _ = Command::new("reg")
        .args([
            "delete",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
            "/v",
            "GeeksPOS",
            "/f",
        ])
        .status();
    let _ = Command::new("schtasks")
        .args(["/Delete", "/F", "/TN", "GeeksPOS_Autostart"])
        .status();
}

#[cfg(not(windows))]
fn disable_windows_autostart_entries() {}

#[cfg(windows)]
fn stop_all_backend_processes() {
    let _ = Command::new("taskkill")
        .args(["/F", "/IM", "geeks_pos_backend.exe", "/T"])
        .status();
    let _ = Command::new("taskkill")
        .args(["/F", "/IM", "geeks_pos_backend-x86_64-pc-windows-msvc.exe", "/T"])
        .status();
    let _ = Command::new("taskkill")
        .args(["/F", "/IM", "geeks_pos_backend-i686-pc-windows-msvc.exe", "/T"])
        .status();
}

#[cfg(not(windows))]
fn stop_all_backend_processes() {}

#[cfg(windows)]
fn kill_process_tree_by_pid(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/F", "/PID", &pid.to_string(), "/T"])
        .status();
}

#[cfg(not(windows))]
fn kill_process_tree_by_pid(_pid: u32) {}

#[cfg(windows)]
fn enable_prevent_sleep() {
    unsafe {
        let _ = SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED);
    }
}

#[cfg(not(windows))]
fn enable_prevent_sleep() {}

#[cfg(windows)]
fn disable_prevent_sleep() {
    unsafe {
        let _ = SetThreadExecutionState(ES_CONTINUOUS);
    }
}

#[cfg(not(windows))]
fn disable_prevent_sleep() {}

#[cfg(windows)]
fn machine_id_windows() -> Result<String, String> {
    let out = Command::new("cmd")
        .args([
            "/C",
            "reg",
            "query",
            "HKLM\\SOFTWARE\\Microsoft\\Cryptography",
            "/v",
            "MachineGuid",
        ])
        .output()
        .map_err(|e| format!("reg query failed: {e}"))?;
    if !out.status.success() {
        return Err("reg query MachineGuid failed".to_string());
    }
    let s = String::from_utf8_lossy(&out.stdout);
    for line in s.lines() {
        let lower = line.to_lowercase();
        if lower.contains("machineguid") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if let Some(guid) = parts.last() {
                if guid.len() >= 32 {
                    return Ok(guid.to_string());
                }
            }
        }
    }
    Err("MachineGuid not found in reg output".to_string())
}

#[tauri::command]
fn machine_id() -> Result<String, String> {
    #[cfg(windows)]
    {
        machine_id_windows()
    }
    #[cfg(not(windows))]
    {
        Err("machine_id is only implemented on Windows".to_string())
    }
}

fn health_ok(port: u16) -> bool {
    if let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) {
        let _ = stream.set_read_timeout(Some(Duration::from_millis(2000)));
        let _ = stream.set_write_timeout(Some(Duration::from_millis(1200)));
        let req = format!(
            "GET /api/health/ HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
        );
        let _ = stream.write_all(req.as_bytes());
        let mut buf = String::new();
        if stream.read_to_string(&mut buf).is_ok() {
            let has_ok_status_line = buf.starts_with("HTTP/1.1 200") || buf.starts_with("HTTP/1.0 200");
            let has_ok_payload = buf.contains("\"status\":\"ok\"") || buf.contains("\"status\": \"ok\"");
            return has_ok_status_line && has_ok_payload;
        }
    }
    false
}

fn backend_script_path() -> PathBuf {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let candidates = vec![
        cwd.join("../backend/run_waitress.py"),
        cwd.join("backend/run_waitress.py"),
        PathBuf::from("../backend/run_waitress.py"),
        PathBuf::from("backend/run_waitress.py"),
    ];
    for p in candidates {
        if p.exists() {
            return p;
        }
    }
    PathBuf::from("../backend/run_waitress.py")
}

fn backend_sidecar_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let candidates = backend_candidate_names();
    for name in candidates {
        if let Some(path) = app.path_resolver().resolve_resource(name) {
            if path.exists() {
                return Some(path);
            }
        }
        let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
        let candidate = exe_dir.join(name);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

fn pick_backend_port(preferred: u16) -> u16 {
    if TcpListener::bind(("127.0.0.1", preferred)).is_ok() {
        return preferred;
    }
    if let Ok(listener) = TcpListener::bind(("127.0.0.1", 0)) {
        if let Ok(addr) = listener.local_addr() {
            return addr.port();
        }
    }
    preferred
}

fn backend_command(app: &tauri::AppHandle, port: u16) -> Result<Command, String> {
    let waitress_threads = std::env::var("WAITRESS_THREADS").unwrap_or_else(|_| "2".to_string());
    let secret_key = runtime_secret_key();
    let django_debug = if cfg!(debug_assertions) { "1" } else { "0" };
    let allow_db_override = if cfg!(debug_assertions) { "1" } else { "0" };
    if let Some(sidecar) = backend_sidecar_path(app) {
        append_log_line("INFO", &format!("Starting sidecar backend: {}", sidecar.display()));
        append_log_line(
            "INFO",
            &format!("backend_env DJANGO_DEBUG={django_debug} GEEKS_POS_ALLOW_DB_OVERRIDE={allow_db_override}"),
        );
        let mut cmd = Command::new(sidecar);
        cmd.arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(port.to_string())
            .arg("--threads")
            .arg(&waitress_threads)
            .env("DJANGO_DEBUG", django_debug)
            .env("GEEKS_POS_ALLOW_DB_OVERRIDE", allow_db_override)
            .env("DJANGO_SECRET_KEY", &secret_key)
            .env("PYTHONUNBUFFERED", "1")
            .env("WAITRESS_THREADS", &waitress_threads);
        return Ok(cmd);
    }

    #[cfg(not(debug_assertions))]
    {
        return Err(
            "Backend sidecar (geeks_pos_backend.exe) topilmadi — bu production build uchun majburiy. Dasturni to‘liq o‘rnating yoki qayta yig‘ing."
                .to_string(),
        );
    }

    #[cfg(debug_assertions)]
    {
        let script = backend_script_path();
        append_log_line("INFO", &format!("Starting python backend: {}", script.display()));
        #[cfg(windows)]
        {
            let mut cmd = Command::new("py");
            cmd.arg("-3")
                .arg(script)
                .arg("--host")
                .arg("127.0.0.1")
                .arg("--port")
                .arg(port.to_string())
                .arg("--threads")
                .arg(&waitress_threads)
                .env("DJANGO_DEBUG", django_debug)
                .env("GEEKS_POS_ALLOW_DB_OVERRIDE", allow_db_override)
                .env("DJANGO_SECRET_KEY", &secret_key)
                .env("PYTHONUNBUFFERED", "1")
                .env("WAITRESS_THREADS", &waitress_threads);
            return Ok(cmd);
        }

        #[cfg(not(windows))]
        {
            let mut cmd = Command::new("python3");
            cmd.arg(script)
                .arg("--host")
                .arg("127.0.0.1")
                .arg("--port")
                .arg(port.to_string())
                .arg("--threads")
                .arg(&waitress_threads)
                .env("DJANGO_DEBUG", django_debug)
                .env("GEEKS_POS_ALLOW_DB_OVERRIDE", allow_db_override)
                .env("DJANGO_SECRET_KEY", &secret_key)
                .env("PYTHONUNBUFFERED", "1")
                .env("WAITRESS_THREADS", &waitress_threads);
            return Ok(cmd);
        }
    }
}

fn ensure_backend_started(app: &tauri::AppHandle, state: &BackendState) -> Result<(), String> {
    append_log_line("INFO", "bootstrap_started");
    let selected_port = pick_backend_port(8000);
    if let Ok(mut lock) = state.port.lock() {
        *lock = selected_port;
    }
    if health_ok(selected_port) {
        append_log_line("INFO", "health_ok_existing");
        if let Ok(mut g) = state.bootstrap_error.lock() {
            *g = None;
        }
        return Ok(());
    }

    {
        let mut lock = state
            .child
            .lock()
            .map_err(|_| "Backend mutex poisoned".to_string())?;
        if let Some(child) = lock.as_mut() {
            match child.try_wait() {
                Ok(None) => {
                    if let Ok(mut g) = state.bootstrap_error.lock() {
                        *g = None;
                    }
                    return Ok(());
                }
                Ok(Some(_)) => {
                    *lock = None;
                }
                Err(e) => {
                    eprintln!("Backend state check warning: {e}");
                    *lock = None;
                }
            }
        }
    }

    let mut cmd = backend_command(app, selected_port).map_err(|e| {
        append_log_line("ERROR", &format!("backend_command_failed: {e}"));
        e
    })?;
    let boot_log_path = app_home_dir().join("logs").join("backend_boot.log");
    let _ = fs::create_dir_all(boot_log_path.parent().unwrap_or_else(|| std::path::Path::new(".")));
    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&boot_log_path)
        .or_else(|_| File::create(&boot_log_path))
        .ok();
    let err_file = log_file
        .as_ref()
        .and_then(|f| f.try_clone().ok());
    cmd.stdin(std::process::Stdio::null());
    if let Some(file) = log_file {
        cmd.stdout(std::process::Stdio::from(file));
    } else {
        cmd.stdout(std::process::Stdio::null());
    }
    if let Some(file) = err_file {
        cmd.stderr(std::process::Stdio::from(file));
    } else {
        cmd.stderr(std::process::Stdio::null());
    }

    let child = cmd.spawn().map_err(|e| format!("Failed to spawn backend: {e}"))?;

    {
        let mut lock = state
            .child
            .lock()
            .map_err(|_| "Backend mutex poisoned".to_string())?;
        *lock = Some(child);
    }

    // Wait up to ~35s with fail-fast if child exits.
    for _ in 0..70 {
        if health_ok(selected_port) {
            append_log_line("INFO", "health_ok_after_spawn");
            if let Ok(mut g) = state.bootstrap_error.lock() {
                *g = None;
            }
            return Ok(());
        }
        {
            let mut lock = state
                .child
                .lock()
                .map_err(|_| "Backend mutex poisoned".to_string())?;
            if let Some(child) = lock.as_mut() {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        append_log_line(
                            "ERROR",
                            &format!("backend_exited_early status={status}"),
                        );
                        *lock = None;
                        let mut msg = format!(
                            "Backend start failed early (status: {status}). Migration/bootstrap xatosi bo‘lishi mumkin — GeeksPOS/logs/backend_boot.log ni tekshiring."
                        );
                        if let Some(h) = boot_log_failure_hint() {
                            msg.push_str("\n\n");
                            msg.push_str(&h);
                        }
                        return Err(msg);
                    }
                    Ok(None) => {}
                    Err(e) => {
                        append_log_line("ERROR", &format!("backend_try_wait_error: {e}"));
                    }
                }
            }
        }
        thread::sleep(Duration::from_millis(500));
    }
    stop_backend(state);
    append_log_line("ERROR", "bootstrap_failed_healthcheck");
    let mut msg =
        "Backend healthcheck timed out. GeeksPOS/logs/backend_boot.log ni tekshiring.".to_string();
    if let Some(h) = boot_log_failure_hint() {
        msg.push_str("\n\n");
        msg.push_str(&h);
    }
    Err(msg)
}

#[tauri::command]
fn get_backend_base_url(state: tauri::State<BackendState>) -> Result<String, String> {
    let port = state
        .port
        .lock()
        .map_err(|_| "Backend port mutex poisoned".to_string())?;
    let base = format!("http://127.0.0.1:{}", *port);
    Ok(base)
}

#[tauri::command]
fn request_app_exit(app: tauri::AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn get_backend_bootstrap_error(state: tauri::State<BackendState>) -> Result<Option<String>, String> {
    state
        .bootstrap_error
        .lock()
        .map(|g| g.clone())
        .map_err(|_| "bootstrap_error mutex poisoned".to_string())
}

#[tauri::command]
fn get_backend_boot_log_path() -> String {
    backend_boot_log_path().to_string_lossy().into_owned()
}

#[tauri::command]
fn retry_backend_start(app: tauri::AppHandle, state: tauri::State<BackendState>) -> Result<(), String> {
    stop_backend(&*state);
    if let Ok(mut g) = state.bootstrap_error.lock() {
        *g = None;
    }
    ensure_backend_started(&app, &state)?;
    Ok(())
}

fn stop_backend(state: &BackendState) {
    if let Ok(mut lock) = state.child.lock() {
        if let Some(child) = lock.as_mut() {
            let pid = child.id();
            // Kill whole backend tree first (waitress/worker descendants), then fallback to std kill.
            kill_process_tree_by_pid(pid);
            if let Ok(None) = child.try_wait() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        *lock = None;
    }
}

#[cfg(windows)]
fn default_printer_name() -> Result<String, String> {
    let mut needed: u32 = 0;
    unsafe {
        let _ = GetDefaultPrinterW(std::ptr::null_mut(), &mut needed as *mut u32);
    }
    if needed == 0 {
        return Err("Default printer not found".to_string());
    }

    let mut buf: Vec<u16> = vec![0; needed as usize + 1];
    let ok = unsafe { GetDefaultPrinterW(buf.as_mut_ptr(), &mut needed as *mut u32) };
    if ok == 0 {
        return Err("GetDefaultPrinterW failed".to_string());
    }
    let end = buf.iter().position(|x| *x == 0).unwrap_or(buf.len());
    String::from_utf16(&buf[..end]).map_err(|e| e.to_string())
}

/// ESC/POS RAW via Win32 **Unicode** printer APIs (OpenPrinterW).
/// `raw-printer` 0.1.x uses OpenPrinterA + CString, which breaks non‑ASCII queue names (Cyrillic, etc.).
#[cfg(windows)]
fn raw_print_win_wide(printer: &str, payload: &[u8], document_name: &str) -> Result<usize, String> {
    use windows_sys::Win32::Foundation::HANDLE;

    let printer_w: Vec<u16> = OsStr::new(printer).encode_wide().chain(std::iter::once(0)).collect();
    let doc_w: Vec<u16> = OsStr::new(document_name).encode_wide().chain(std::iter::once(0)).collect();
    let datatype_w: Vec<u16> = OsStr::new("RAW").encode_wide().chain(std::iter::once(0)).collect();

    let mut printer_handle: HANDLE = std::ptr::null_mut();
    let pd = PRINTER_DEFAULTSW {
        pDatatype: std::ptr::null_mut(),
        pDevMode: std::ptr::null_mut(),
        DesiredAccess: PRINTER_ACCESS_USE,
    };

    unsafe {
        if OpenPrinterW(printer_w.as_ptr(), &mut printer_handle, &pd) == 0 {
            return Err(format!(
                "OpenPrinterW failed (printer={printer:?}): Win32 {}",
                GetLastError()
            ));
        }

        struct PrinterClose(HANDLE);
        impl Drop for PrinterClose {
            fn drop(&mut self) {
                unsafe {
                    let _ = ClosePrinter(self.0);
                }
            }
        }
        let _close = PrinterClose(printer_handle);

        let doc_info = DOC_INFO_1W {
            pDocName: doc_w.as_ptr() as *mut u16,
            pOutputFile: std::ptr::null_mut(),
            pDatatype: datatype_w.as_ptr() as *mut u16,
        };

        let job_id = StartDocPrinterW(printer_handle, 1, &doc_info as *const DOC_INFO_1W as *const _);
        if job_id == 0 {
            return Err(format!("StartDocPrinterW failed: Win32 {}", GetLastError()));
        }

        if StartPagePrinter(printer_handle) == 0 {
            let _ = EndDocPrinter(printer_handle);
            return Err(format!("StartPagePrinter failed: Win32 {}", GetLastError()));
        }

        let mut bytes_written: u32 = 0;
        let write_ok = WritePrinter(
            printer_handle,
            payload.as_ptr().cast(),
            payload.len() as u32,
            &mut bytes_written,
        );

        let _ = EndPagePrinter(printer_handle);
        let _ = EndDocPrinter(printer_handle);

        if write_ok == 0 {
            return Err(format!("WritePrinter failed: Win32 {}", GetLastError()));
        }

        let n = bytes_written as usize;
        if n == 0 {
            return Err("WritePrinter reported zero bytes".to_string());
        }
        Ok(n)
    }
}

#[cfg(windows)]
fn raw_print_to(printer_name: Option<&str>, bytes: &[u8], doc_name: &str) -> Result<(), String> {
    let name = match printer_name.map(str::trim).filter(|s| !s.is_empty()) {
        Some(s) => s.to_string(),
        None => default_printer_name()?,
    };
    let written = raw_print_win_wide(&name, bytes, doc_name)?;
    if written == 0 {
        return Err("RAW print wrote zero bytes".to_string());
    }
    Ok(())
}

#[cfg(windows)]
unsafe fn wide_ptr_to_string(ptr: *const u16) -> Option<String> {
    if ptr.is_null() {
        return None;
    }
    let mut len = 0usize;
    while *ptr.add(len) != 0 {
        len += 1;
        if len > 4096 {
            return None;
        }
    }
    let slice = std::slice::from_raw_parts(ptr, len);
    String::from_utf16(slice).ok()
}

/// Local + connected printers (fast level 4).
#[cfg(windows)]
fn list_installed_printers() -> Result<Vec<String>, String> {
    const PRINTER_ENUM_LOCAL: u32 = 2;
    const PRINTER_ENUM_CONNECTIONS: u32 = 4;
    let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;

    let mut needed: u32 = 0;
    let mut returned: u32 = 0;

    let ok = unsafe {
        EnumPrintersW(
            flags,
            std::ptr::null::<u16>(),
            4,
            std::ptr::null_mut(),
            0,
            &mut needed,
            &mut returned,
        )
    };
    if ok == 0 {
        let err = unsafe { GetLastError() };
        if err != ERROR_INSUFFICIENT_BUFFER {
            return Err(format!("EnumPrintersW probe failed: Win32 error {err}"));
        }
    }
    if needed == 0 {
        return Ok(vec![]);
    }

    let mut buf = vec![0u8; needed as usize];
    let ok2 = unsafe {
        EnumPrintersW(
            flags,
            std::ptr::null::<u16>(),
            4,
            buf.as_mut_ptr(),
            buf.len() as u32,
            &mut needed,
            &mut returned,
        )
    };
    if ok2 == 0 {
        return Err(format!(
            "EnumPrintersW failed: Win32 error {}",
            unsafe { GetLastError() }
        ));
    }

    let mut names = Vec::new();
    if returned == 0 {
        return Ok(names);
    }
    unsafe {
        let base = buf.as_ptr() as *const PRINTER_INFO_4W;
        for i in 0..returned as usize {
            let info = &*base.add(i);
            if let Some(s) = wide_ptr_to_string(info.pPrinterName as *const u16) {
                if !s.is_empty() {
                    names.push(s);
                }
            }
        }
    }
    Ok(names)
}

#[tauri::command]
fn print_plain(text: String) -> Result<String, String> {
    let mut path = std::env::temp_dir();
    path.push(format!("geeks_pos_{}.txt", uuid::Uuid::new_v4()));
    fs::write(&path, &text).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        let p = path.to_string_lossy().to_string();
        Command::new("notepad.exe")
            .args(["/p", &p])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn print_raw(payload: String, printer_name: Option<String>) -> Result<String, String> {
    let bytes: Vec<u8> = B64
        .decode(payload.trim())
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter(|&b| b != 0x07)
        .collect();

    #[cfg(windows)]
    {
        let _guard = RAW_PRINT_MUTEX
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let target = printer_name.as_deref().map(str::trim).filter(|s| !s.is_empty());
        raw_print_to(target, &bytes, "Geeks POS RAW")?;
        // Brief pause so the USB driver can release the endpoint before the next RAW job (e.g. receipt → label).
        thread::sleep(Duration::from_millis(50));
        let label = target.unwrap_or("(default Windows printer)");
        return Ok(format!("Queued to {label}"));
    }

    #[allow(unreachable_code)]
    Err("Raw printing is only supported on Windows".to_string())
}

#[tauri::command]
fn print_escpos(payload: String, printer_name: Option<String>) -> Result<String, String> {
    print_raw(payload, printer_name)
}

#[tauri::command]
fn list_printers() -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
        list_installed_printers()
    }
    #[cfg(not(windows))]
    {
        Ok(vec![])
    }
}

#[tauri::command]
fn append_app_log(level: String, message: String) -> Result<(), String> {
    append_log_line(level.trim(), message.trim());
    Ok(())
}

#[cfg(windows)]
fn ensure_webview2_runtime() -> Result<(), String> {
    let probe = Command::new("reg")
        .args([
            "query",
            r"HKLM\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
            "/v",
            "pv",
        ])
        .output()
        .map_err(|e| format!("WebView2 check failed: {e}"))?;
    if probe.status.success() {
        return Ok(());
    }
    let probe_x86 = Command::new("reg")
        .args([
            "query",
            r"HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
            "/v",
            "pv",
        ])
        .output()
        .map_err(|e| format!("WebView2 x86 check failed: {e}"))?;
    if probe_x86.status.success() {
        return Ok(());
    }
    Err("Microsoft Edge WebView2 Runtime topilmadi. Iltimos runtime'ni o'rnating.".to_string())
}

#[cfg(not(windows))]
fn ensure_webview2_runtime() -> Result<(), String> {
    Ok(())
}

fn main() {
    let state = BackendState {
        child: Mutex::new(None),
        port: Mutex::new(8000),
        bootstrap_error: Mutex::new(None),
    };

    let app = tauri::Builder::default()
        .manage(state)
        .setup(|app| {
            // Clean up stale backend sidecars from previous unclean exits before starting a fresh one.
            stop_all_backend_processes();
            if let Err(e) = ensure_webview2_runtime() {
                append_log_line("ERROR", &e);
                if let Some(win) = app.get_window("main") {
                    tauri::api::dialog::blocking::message(Some(&win), "WebView2 talab qilinadi", &e);
                } else {
                    eprintln!("WebView2 talab qilinadi: {e}");
                }
                return Err(e.into());
            }
            let state = app.state::<BackendState>();
            if let Err(e) = ensure_backend_started(&app.handle(), &state) {
                append_log_line("WARN", &format!("Backend start failed (continuing in degraded mode): {e}"));
                if let Ok(mut g) = state.bootstrap_error.lock() {
                    *g = Some(e.clone());
                }
                if let Some(win) = app.get_window("main") {
                    tauri::api::dialog::blocking::message(
                        Some(&win),
                        "Backend ishga tushmadi",
                        &format!(
                            "{e}\n\nDastur cheklangan rejimda ochiladi. Ilovada 'Qayta urinish' tugmasi backendni qayta ishga tushirishga urinadi.\n\nLog: GeeksPOS/logs/backend_boot.log"
                        ),
                    );
                }
            } else if let Ok(mut g) = state.bootstrap_error.lock() {
                *g = None;
            }
            // Explicitly disable startup autorun/task entries (requested for POS stability).
            disable_windows_autostart_entries();
            enable_prevent_sleep();
            spawn_notification_flush_loop(app.handle());
            if let Some(window) = app.get_window("main") {
                let kiosk = std::env::var("GEEKS_POS_KIOSK")
                    .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
                    .unwrap_or(false);
                if kiosk {
                    let _ = window.set_always_on_top(true);
                    let _ = window.set_fullscreen(true);
                    let _ = window.set_decorations(false);
                    let _ = window.set_resizable(false);
                } else {
                    let _ = window.set_always_on_top(false);
                    let _ = window.set_fullscreen(false);
                    let _ = window.set_decorations(false);
                    let _ = window.set_resizable(true);
                    let _ = window.set_size(LogicalSize::new(1366.0, 768.0));
                    let _ = window.center();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            print_plain,
            print_raw,
            print_escpos,
            list_printers,
            machine_id,
            append_app_log,
            get_backend_base_url,
            get_backend_bootstrap_error,
            get_backend_boot_log_path,
            retry_backend_start,
            request_app_exit
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri app");

    app.run(|app_handle, event| {
        match event {
            tauri::RunEvent::WindowEvent { label, event, .. } => {
                if label == "main" {
                    match event {
                        tauri::WindowEvent::CloseRequested { api, .. } => {
                            api.prevent_close();
                            let state = app_handle.state::<BackendState>();
                            stop_backend(&state);
                            stop_all_backend_processes();
                            disable_prevent_sleep();
                            append_log_line("INFO", "Main window close requested; backend processes stopped.");
                            app_handle.exit(0);
                        }
                        tauri::WindowEvent::Focused(false) => {
                            if std::env::var("GEEKS_POS_KIOSK_FOCUS_RECLAIM")
                                .map(|v| v == "1")
                                .unwrap_or(false)
                            {
                                if let Some(window) = app_handle.get_window("main") {
                                    let _ = window.set_focus();
                                }
                            }
                        }
                        tauri::WindowEvent::Destroyed => {
                            let state = app_handle.state::<BackendState>();
                            stop_backend(&state);
                            stop_all_backend_processes();
                            disable_prevent_sleep();
                        }
                        _ => {}
                    }
                }
            }
            tauri::RunEvent::ExitRequested { .. } => {
                let state = app_handle.state::<BackendState>();
                stop_backend(&state);
                stop_all_backend_processes();
                disable_prevent_sleep();
                append_log_line("INFO", "Application exit requested; backend stopped.");
            }
            _ => {}
        }
    });
}
