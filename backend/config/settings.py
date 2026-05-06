"""
Django settings for local MVP (SQLite, localhost API).
"""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from corsheaders.defaults import default_headers

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_env_files() -> None:
    """
    Load .env from common runtime locations.

    Why: in packaged (PyInstaller sidecar) runs, cwd/BASE_DIR can differ from repo layout,
    so relying only on repo-root/backed/.env may miss license settings.
    """
    candidates: list[Path] = [
        BASE_DIR.parent / ".env",  # repo root (dev)
        BASE_DIR / ".env",  # backend/.env (dev)
        Path.cwd() / ".env",  # runtime cwd
        Path.cwd() / "backend" / ".env",  # runtime cwd with backend subdir
    ]
    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).resolve().parent
        candidates.extend(
            [
                exe_dir / ".env",  # sidecar рядом
                exe_dir / "backend" / ".env",
            ]
        )
    for p in candidates:
        try:
            load_dotenv(p, override=False)
        except OSError:
            continue


_load_env_files()


def _resolve_writable_app_home() -> Path:
    """
    Prefer %APPDATA%\\GeeksPOS, then %LOCALAPPDATA%\\GeeksPOS, then ~/GeeksPOS, then repo-local.
    """
    candidates: list[Path] = []
    if os.environ.get("APPDATA"):
        candidates.append(Path(os.environ["APPDATA"]) / "GeeksPOS")
    if os.environ.get("LOCALAPPDATA"):
        candidates.append(Path(os.environ["LOCALAPPDATA"]) / "GeeksPOS")
    candidates.append(Path.home() / "GeeksPOS")
    candidates.append(BASE_DIR / ".geeks_pos")

    last_err: OSError | None = None
    for base in candidates:
        try:
            base.mkdir(parents=True, exist_ok=True)
            probe = base / ".write_probe"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink(missing_ok=True)
            return base
        except OSError as exc:
            last_err = exc
            continue
    raise RuntimeError(
        "GeeksPOS: could not create a writable data directory. "
        f"Last error: {last_err}"
    ) from last_err

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-only-change-in-production-geeks-pos-mvp")
DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"
if not DEBUG and (
    not SECRET_KEY or SECRET_KEY == "dev-only-change-in-production-geeks-pos-mvp"
):
    raise RuntimeError("DJANGO_SECRET_KEY must be set when DEBUG=0")
ALLOWED_HOSTS = ["127.0.0.1", "localhost"]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework.authtoken",
    "corsheaders",
    "core.apps.CoreConfig",
    "accounts.apps.AccountsConfig",
    "catalog",
    "inventory",
    "sales",
    "debt",
    "printing",
    "sync",
    "reports",
    "integrations",
    "licensing.apps.LicensingConfig",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "licensing.middleware.LicenseEnforcementMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

APP_HOME_DIR = _resolve_writable_app_home()
APPDATA_ROOT = APP_HOME_DIR.parent
db_override = os.environ.get("GEEKS_POS_DB_PATH", "").strip()
allow_db_override = os.environ.get("GEEKS_POS_ALLOW_DB_OVERRIDE", "1" if DEBUG else "0") == "1"
if db_override and allow_db_override:
    DB_PATH = Path(db_override)
else:
    DB_PATH = APP_HOME_DIR / "db.sqlite3"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
LEGACY_DB_PATH = BASE_DIR / "db.sqlite3"
allow_legacy_import = os.environ.get("GEEKS_POS_ALLOW_LEGACY_DB_IMPORT", "0") == "1"
if allow_legacy_import and not DB_PATH.exists() and LEGACY_DB_PATH.exists():
    # Optional one-time migration path for upgrades from repo-local SQLite.
    DB_PATH.write_bytes(LEGACY_DB_PATH.read_bytes())

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": DB_PATH,
        "OPTIONS": {"timeout": 30},
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "uz"
TIME_ZONE = "Asia/Tashkent"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
MEDIA_URL = "/media/"
MEDIA_ROOT = APP_HOME_DIR / "media"
MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.TokenAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser", "rest_framework.parsers.MultiPartParser"],
}

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "geeks-pos-default",
        "TIMEOUT": 60,
    }
}

CORS_ALLOWED_ORIGINS = [
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:5175",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "tauri://localhost",
]
CORS_ALLOWED_ORIGIN_REGEXES = [
    r"^http://localhost:\d+$",
]
CORS_ALLOW_CREDENTIALS = True
# Tauri/WebView2 uses CORS rules. Some POST requests include custom headers that trigger preflight
# (e.g. Idempotency-Key on /api/sales/complete/). If not allowlisted, the browser reports "Failed to fetch"
# and the request never reaches Django views (backend.log remains clean).
CORS_ALLOW_HEADERS = (*default_headers, "authorization", "idempotency-key", "x-csrftoken")

# License / Owner Dashboard (set in production)
# Must be absolute, e.g. https://api.geeks.uz — not a path-only value like /api/v1/ (see licensing.remote_client).
# POS uses (under this base): POST api/v1/verify-activation-key/, POST api/v1/activate/, GET api/v1/check-status/,
# POST api/v1/sync-report/. Token + X-CLIENT-KEY on every call (see licensing.remote_client).
# Packaged sidecar: run_waitress sets DJANGO_DEBUG=0 when frozen; Tauri also passes DJANGO_DEBUG=0 in release.
LICENSE_API_BASE_URL = os.environ.get("LICENSE_API_BASE_URL", "").strip()
LICENSE_AUTH_TOKEN = os.environ.get("LICENSE_AUTH_TOKEN", "").strip()
LICENSE_CLIENT_API_KEY = os.environ.get("LICENSE_CLIENT_API_KEY", "").strip()
LICENSE_ENFORCEMENT = os.environ.get("LICENSE_ENFORCEMENT", "0" if DEBUG else "1") == "1"
LICENSE_OFFLINE_GRACE_HOURS = int(os.environ.get("LICENSE_OFFLINE_GRACE_HOURS", "72"))
LICENSE_DEMO_DAYS = int(os.environ.get("LICENSE_DEMO_DAYS", "14"))
INTERNAL_FLUSH_KEY = os.environ.get("INTERNAL_FLUSH_KEY", "").strip()
BACKUP_UPLOAD_ENABLED = os.environ.get("BACKUP_UPLOAD_ENABLED", "0") == "1"
BACKUP_UPLOAD_URL = os.environ.get("BACKUP_UPLOAD_URL", "").strip()
BACKUP_AUTH_TOKEN = os.environ.get("BACKUP_AUTH_TOKEN", "").strip()
BACKUP_CLIENT_KEY = os.environ.get("BACKUP_CLIENT_KEY", "").strip()
try:
    BACKUP_INTERVAL_HOURS = max(1, int(os.environ.get("BACKUP_INTERVAL_HOURS", "24")))
except ValueError:
    BACKUP_INTERVAL_HOURS = 24
if DEBUG and not INTERNAL_FLUSH_KEY:
    INTERNAL_FLUSH_KEY = "dev-internal-flush-key"

CSRF_TRUSTED_ORIGINS = [
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:5175",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://127.0.0.1:8000",
    "http://localhost:8000",
    "https://tauri.localhost",
]

LOG_DIR = Path(os.environ.get("GEEKS_POS_LOG_DIR", str(APP_HOME_DIR / "logs")))
LOG_DIR.mkdir(parents=True, exist_ok=True)
APP_LOG_FILE = LOG_DIR / "backend.log"

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {
        "console": {"class": "logging.StreamHandler"},
        "file": {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": str(APP_LOG_FILE),
            "maxBytes": 2 * 1024 * 1024,
            "backupCount": 3,
            "encoding": "utf-8",
        },
    },
    "root": {
        "handlers": ["console", "file"] if DEBUG else ["file"],
        "level": "INFO",
    },
    "loggers": {
        "audit": {
            "handlers": ["console", "file"] if DEBUG else ["file"],
            "level": "INFO",
            "propagate": False,
        },
        "django.db.backends": {"handlers": ["file"], "level": "WARNING", "propagate": False},
    },
}
