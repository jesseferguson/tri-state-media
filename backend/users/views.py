from django.conf import settings
from rest_framework import filters, status, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .auth import company_user_from_request, create_company_user_token, request_user_is_admin
from .models import CompanyRole, CompanyUser
from .serializers import CompanyRoleSerializer, CompanyUserSerializer


class BaseUsersViewSet(viewsets.ModelViewSet):
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    parser_classes = [JSONParser, FormParser, MultiPartParser]


class AdminWriteMixin:
    def _admin_write_allowed(self, request):
        return not settings.API_AUTH_REQUIRED or request_user_is_admin(request)

    def create(self, request, *args, **kwargs):
        if not self._admin_write_allowed(request):
            return Response({"detail": "Only an active Admin user can change company access."}, status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        if not self._admin_write_allowed(request):
            return Response({"detail": "Only an active Admin user can change company access."}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        if not self._admin_write_allowed(request):
            user = company_user_from_request(request)
            target_id = str(kwargs.get(getattr(self, "lookup_url_kwarg", None) or self.lookup_field))
            allowed_self_update = (
                self.__class__.__name__ == "CompanyUserViewSet"
                and user
                and str(user.pk) == target_id
                and set(request.data.keys()).issubset({"quoteCompany", "quote_company"})
            )
            if not allowed_self_update:
                return Response({"detail": "Only an active Admin user can change company access."}, status=status.HTTP_403_FORBIDDEN)
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if not self._admin_write_allowed(request):
            return Response({"detail": "Only an active Admin user can change company access."}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)


class CompanyRoleViewSet(AdminWriteMixin, BaseUsersViewSet):
    queryset = CompanyRole.objects.all().order_by("name")
    serializer_class = CompanyRoleSerializer
    search_fields = ["name", "description"]
    ordering_fields = ["name", "created_at"]

    def get_queryset(self):
        queryset = super().get_queryset()
        if not settings.API_AUTH_REQUIRED or request_user_is_admin(self.request):
            return queryset
        user = company_user_from_request(self.request)
        return queryset.filter(pk=getattr(user, "role_id", None)) if user else queryset.none()


class CompanyUserViewSet(AdminWriteMixin, BaseUsersViewSet):
    queryset = CompanyUser.objects.select_related("role").all().order_by("name", "username")
    serializer_class = CompanyUserSerializer
    search_fields = ["name", "username", "role__name", "quote_company"]
    ordering_fields = ["name", "username", "quote_company", "active", "created_at"]

    def get_queryset(self):
        queryset = super().get_queryset()
        if not settings.API_AUTH_REQUIRED or request_user_is_admin(self.request):
            return queryset
        user = company_user_from_request(self.request)
        return queryset.filter(pk=getattr(user, "pk", None)) if user else queryset.none()


@api_view(["POST"])
@permission_classes([AllowAny])
def company_sign_in(request):
    username = str(request.data.get("username", "")).strip().lower()
    password = str(request.data.get("password", ""))
    try:
        user = CompanyUser.objects.select_related("role").get(username__iexact=username)
    except CompanyUser.DoesNotExist:
        return Response({"error": "Username or password is not correct."}, status=status.HTTP_400_BAD_REQUEST)

    if not user.check_password(password):
        return Response({"error": "Username or password is not correct."}, status=status.HTTP_400_BAD_REQUEST)
    legacy_default_admin_password = "Blue" "labels7&"
    if settings.BLOCK_LEGACY_DEFAULT_ADMIN_PASSWORD and username == "admin" and password == legacy_default_admin_password:
        return Response(
            {"error": "The legacy default admin password is blocked. Reset the admin password before signing in."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not user.active:
        return Response({"error": "This user is inactive. Ask an admin to reactivate the account."}, status=status.HTTP_400_BAD_REQUEST)

    is_admin = str(getattr(user.role, "name", "") or "").lower() == "admin"
    users = CompanyUser.objects.select_related("role").all()
    roles = CompanyRole.objects.all()
    if not is_admin:
        users = users.filter(pk=user.pk)
        roles = roles.filter(pk=user.role_id)

    return Response({
        "user": CompanyUserSerializer(user).data,
        "users": CompanyUserSerializer(users, many=True).data,
        "roles": CompanyRoleSerializer(roles, many=True).data,
        "token": create_company_user_token(user),
        "expiresIn": settings.API_SESSION_SECONDS,
    })
