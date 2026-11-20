from django.urls import path

import views

urlpatterns = [path("webhooks/signatureapi", views.signatureapi_webhook)]
