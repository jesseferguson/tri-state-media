from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path('admin/', admin.site.urls),
    path("api/", include("tooling.urls")),
    path("api/", include("materials.urls")),
    path("api/", include("production.urls")),
    path("api-auth/", include("rest_framework.urls")),
]
