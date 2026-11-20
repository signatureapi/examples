import os
from pathlib import Path

SECRET_KEY = "not-used-by-this-example"  # No sessions or cookies are used. Set a real one in a real project.
DEBUG = False
ALLOWED_HOSTS = ["*"]
ROOT_URLCONF = "urls"
INSTALLED_APPS = []
MIDDLEWARE = ["django.middleware.csrf.CsrfViewMiddleware"]
USE_TZ = True
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [Path(__file__).resolve().parent / "templates"],
}]

SIGNATUREAPI_KEY = os.environ.get("SIGNATUREAPI_KEY", "")
SIGNATUREAPI_BASE_URL = os.environ.get("SIGNATUREAPI_BASE_URL", "")
SIGNATUREAPI_WEBHOOK_SECRET = os.environ.get("SIGNATUREAPI_WEBHOOK_SECRET", "")
APP_ORIGIN = os.environ.get("APP_ORIGIN", "http://localhost:8000")
