from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import CompanyRoleViewSet, CompanyUserViewSet, company_sign_in


router = DefaultRouter()
router.register("company-roles", CompanyRoleViewSet, basename="company-role")
router.register("company-users", CompanyUserViewSet, basename="company-user")

urlpatterns = [
    path("auth/sign-in/", company_sign_in, name="company-sign-in"),
    *router.urls,
]
