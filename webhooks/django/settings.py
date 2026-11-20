import os

SECRET_KEY = "not-used-by-this-example"  # No sessions or cookies are used. Set a real one in a real project.
DEBUG = False
ALLOWED_HOSTS = ["*"]
ROOT_URLCONF = "urls"
INSTALLED_APPS = []
MIDDLEWARE = []
USE_TZ = True
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

SIGNATUREAPI_WEBHOOK_SECRET = os.environ.get("SIGNATUREAPI_WEBHOOK_SECRET", "")
