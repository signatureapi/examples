from django.urls import path

import views

urlpatterns = [
    path("", views.index),
    path("api/contracts", views.create_contract),
    path("api/contracts/<uuid:envelope_id>", views.contract_status),
    path("api/contracts/<uuid:envelope_id>/signed.pdf", views.signed_pdf),
    path("webhooks/signatureapi", views.webhook),
]
