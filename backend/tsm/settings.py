import os
import dj_database_url
from pathlib import Path
from django.core.exceptions import ImproperlyConfigured
from corsheaders.defaults import default_headers
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

DEBUG = os.environ.get("DEBUG", "False") == "True"

SECRET_KEY = os.environ.get("SECRET_KEY")
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = "dev-secret-key-only-for-local"
    else:
        raise ImproperlyConfigured("Set SECRET_KEY in the environment before running without DEBUG=True.")

FIREBASE_PRINT_QUEUE_BASE = os.environ.get(
    "FIREBASE_PRINT_QUEUE_BASE",
    "https://realtime-database-8bbe2-default-rtdb.firebaseio.com",
).rstrip("/")
FIREBASE_PRINT_QUEUE_ROOT = os.environ.get(
    "FIREBASE_PRINT_QUEUE_ROOT",
    "TEST_PRESS_001",
).strip("/")
FIREBASE_PRINT_QUEUE_NAME = os.environ.get(
    "FIREBASE_PRINT_QUEUE_NAME",
    "print_node",
).strip("/")
FRONTEND_PUBLIC_URL = os.environ.get(
    "FRONTEND_PUBLIC_URL",
    "https://tri-state-media-front-end.onrender.com",
).rstrip("/")

ALLOWED_HOSTS = [
    "localhost",
    "127.0.0.1",
    "192.168.1.134",
    "192.168.1.174",
    "tri-state-media-backend.onrender.com",
]

EXTRA_ALLOWED_HOSTS = os.environ.get("ALLOWED_HOSTS", "")
for host in [value.strip() for value in EXTRA_ALLOWED_HOSTS.split(",") if value.strip()]:
    ALLOWED_HOSTS.append(host)

LOCAL_BACKEND_HOST = os.environ.get("LOCAL_BACKEND_HOST")
if LOCAL_BACKEND_HOST:
    ALLOWED_HOSTS.append(LOCAL_BACKEND_HOST)

RENDER_EXTERNAL_HOSTNAME = os.environ.get("RENDER_EXTERNAL_HOSTNAME")
if RENDER_EXTERNAL_HOSTNAME:
    ALLOWED_HOSTS.append(RENDER_EXTERNAL_HOSTNAME)


INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    # 3rd party apps
    "rest_framework",
    "corsheaders",

    # primary apps
    "tooling",
    "materials",
    "production",
]

if os.environ.get("AWS_STORAGE_BUCKET_NAME"):
    INSTALLED_APPS.append("storages")

def env_list(name, defaults=()):
    values = [value.strip() for value in os.environ.get(name, "").split(",") if value.strip()]
    return values or list(defaults)


CORS_ALLOW_ALL_ORIGINS = os.environ.get("CORS_ALLOW_ALL_ORIGINS", "False") == "True" and DEBUG
CORS_ALLOW_HEADERS = (
    *default_headers,
    "x-company-user-id",
    "x-company-username",
    "x-device-token",
)

CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://192.168.1.134:5173",
    "http://192.168.1.174:5173",
    "https://tri-state-media-front-end.onrender.com",
])

CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS", CORS_ALLOWED_ORIGINS)

API_AUTH_REQUIRED = os.environ.get("API_AUTH_REQUIRED", "False" if DEBUG else "True") == "True"
API_SESSION_SECONDS = int(os.environ.get("API_SESSION_SECONDS", str(12 * 60 * 60)))
LIVE_FOOTAGE_DEVICE_TOKEN = os.environ.get("LIVE_FOOTAGE_DEVICE_TOKEN", "")
BLOCK_LEGACY_DEFAULT_ADMIN_PASSWORD = (
    os.environ.get("BLOCK_LEGACY_DEFAULT_ADMIN_PASSWORD", "False" if DEBUG else "True") == "True"
)
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
SECURE_REFERRER_POLICY = "same-origin"

DATA_UPLOAD_MAX_MEMORY_SIZE = int(os.environ.get("DATA_UPLOAD_MAX_MEMORY_SIZE", str(MAX_UPLOAD_BYTES)))
FILE_UPLOAD_MAX_MEMORY_SIZE = int(os.environ.get("FILE_UPLOAD_MAX_MEMORY_SIZE", str(MAX_UPLOAD_BYTES)))

if DEBUG:
    CSRF_TRUSTED_ORIGINS += [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://192.168.1.134:5173",
        "http://192.168.1.174:5173",
    ]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = 'tsm.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'tsm.wsgi.application'


DATABASES = {
    "default": dj_database_url.config(
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        conn_max_age=600,
    )
}


# Password validation
# https://docs.djangoproject.com/en/6.0/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]


# Internationalization
# https://docs.djangoproject.com/en/6.0/topics/i18n/

LANGUAGE_CODE = 'en-us'

TIME_ZONE = 'UTC'

USE_I18N = True

USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/6.0/howto/static-files/

STATIC_URL = 'static/'


REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "production.auth.CompanyUserTokenAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "production.auth.HasCompanyResourceAccess" if API_AUTH_REQUIRED else "rest_framework.permissions.AllowAny",
    ],
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
    "DEFAULT_FILTER_BACKENDS": [
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
    "PAGE_SIZE_QUERY_PARAM": "page_size",
    "MAX_PAGE_SIZE": 200,
}

if DEBUG:
    REST_FRAMEWORK["DEFAULT_RENDERER_CLASSES"].append("rest_framework.renderers.BrowsableAPIRenderer")

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

if os.environ.get("AWS_STORAGE_BUCKET_NAME"):
    AWS_STORAGE_BUCKET_NAME = os.environ.get("AWS_STORAGE_BUCKET_NAME")
    AWS_S3_ENDPOINT_URL = os.environ.get("AWS_S3_ENDPOINT_URL", "").rstrip("/")
    AWS_S3_REGION_NAME = os.environ.get("AWS_S3_REGION_NAME", "auto")
    AWS_S3_SIGNATURE_VERSION = os.environ.get("AWS_S3_SIGNATURE_VERSION", "s3v4")
    AWS_S3_ADDRESSING_STYLE = os.environ.get("AWS_S3_ADDRESSING_STYLE", "path")
    AWS_S3_FILE_OVERWRITE = False
    AWS_DEFAULT_ACL = None
    AWS_QUERYSTRING_AUTH = os.environ.get("AWS_QUERYSTRING_AUTH", "True") != "False"
    STORAGES["default"] = {
        "BACKEND": "storages.backends.s3boto3.S3Boto3Storage",
        "OPTIONS": {
            "bucket_name": AWS_STORAGE_BUCKET_NAME,
            "endpoint_url": AWS_S3_ENDPOINT_URL,
            "region_name": AWS_S3_REGION_NAME,
            "signature_version": AWS_S3_SIGNATURE_VERSION,
            "addressing_style": AWS_S3_ADDRESSING_STYLE,
            "file_overwrite": AWS_S3_FILE_OVERWRITE,
            "default_acl": AWS_DEFAULT_ACL,
            "querystring_auth": AWS_QUERYSTRING_AUTH,
        },
    }
