from django.conf import settings
from django.core import signing
from django.utils.crypto import constant_time_compare, salted_hmac
from rest_framework import authentication, exceptions, permissions, status
from rest_framework.response import Response


TOKEN_SALT = "tri-state-media.company-user-token"
TOKEN_FINGERPRINT_SALT = "tri-state-media.company-user-token-fingerprint"

RESOURCE_KEYS_BY_BASENAME = {
    "box": ("boxes", "job-tickets", "production-schedule"),
    "box-inventory": ("box-inventory", "packaging-inventory", "job-tickets", "production-schedule"),
    "core": ("cores", "job-tickets", "production-schedule"),
    "core-inventory": ("core-inventory", "packaging-inventory", "job-tickets", "production-schedule"),
    "customer": ("customers", "quote-calculator", "job-tickets", "production-schedule", "customer-orders"),
    "customer-order": ("customer-orders", "production-schedule", "job-tickets"),
    "customer-order-event": ("customer-order-events", "customer-orders", "production-schedule"),
    "finished-inventory": ("finished-inventory", "job-tickets", "production-schedule"),
    "flex-die": ("flex-dies", "recipes", "recipe-options", "recipe-tools", "job-tickets", "production-schedule"),
    "flex-die-request": ("flex-die-requests",),
    "history": ("history", "flex-dies", "rotary-dies", "mags"),
    "job-ticket": ("job-tickets", "quote-calculator", "production-schedule"),
    "job-ticket-event": ("job-ticket-events", "job-ticket-change-approval", "job-tickets"),
    "job-ticket-usage": ("job-ticket-usages", "job-tickets"),
    "live-footage-archive": ("live-footage", "footage-reports"),
    "local-live-footage-reading": ("live-footage", "footage-reports"),
    "location": ("locations", "material-handling", "skids", "racks", "raw-materials", "finished-inventory", "flex-dies", "rotary-dies", "mags", "presses"),
    "mag": ("mags", "recipes", "recipe-options", "recipe-tools", "job-tickets", "production-schedule"),
    "material": ("materials", "material-coated-stock", "material-faces", "material-liners", "material-adhesives", "material-silicone", "quote-calculator", "job-tickets", "production-schedule", "material-handling"),
    "material-master-type": ("material-master-types", "materials", "quote-calculator", "job-tickets", "production-schedule", "material-handling"),
    "material-movement": ("material-handling", "skids", "racks"),
    "material-supplier-option": ("material-supplier-options", "materials", "material-handling"),
    "material-usage": ("material-usages", "material-handling", "job-tickets", "production-schedule", "finished-inventory"),
    "perf-blade": ("perf-blades", "perf-blade-setups", "recipes", "recipe-options", "recipe-tools"),
    "perf-blade-setup": ("perf-blade-setups", "recipes", "recipe-options", "recipe-tools"),
    "perf-cylinder": ("perf-cylinders", "perf-blade-setups", "recipes", "recipe-options", "recipe-tools"),
    "press": ("presses", "production-schedule", "live-footage", "footage-reports", "recipes", "recipe-options"),
    "print-plate": ("print-plates", "recipes"),
    "print-station": ("print-stations", "print-plates", "recipes"),
    "production-material-assignment": ("production-schedule", "material-handling"),
    "production-schedule": ("production-schedule", "job-tickets"),
    "production-shift-report": ("footage-reports", "production-schedule", "live-footage", "coater-operator"),
    "production-shift-setting": ("footage-reports", "production-schedule", "live-footage"),
    "quote-cost-rate": ("quote-calculator", "quote-material-admin"),
    "quote-finished-material": ("quote-calculator", "quote-material-admin"),
    "quote-raw-material": ("quote-calculator", "quote-material-admin"),
    "quote-record": ("quote-calculator", "quote-approval"),
    "rack": ("racks", "material-handling"),
    "raw-material": ("raw-materials", "material-handling", "production-schedule", "job-tickets", "finished-inventory"),
    "recipe": ("recipes", "job-tickets", "production-schedule", "quote-calculator", "finished-inventory"),
    "recipe-option": ("recipe-options", "recipes", "job-tickets", "production-schedule"),
    "recipe-tool": ("recipe-tools", "recipe-options", "recipes", "job-tickets", "production-schedule"),
    "rotary-die": ("rotary-dies", "recipes", "recipe-options", "recipe-tools"),
    "skid": ("skids", "material-handling"),
    "supplier": ("suppliers", "materials", "flex-dies", "rotary-dies", "mags", "recipes"),
}


def _token_fingerprint(user):
    return salted_hmac(
        TOKEN_FINGERPRINT_SALT,
        f"{user.pk}:{user.username}:{user.password_hash}:{user.active}",
        secret=settings.SECRET_KEY,
    ).hexdigest()


def create_company_user_token(user):
    return signing.dumps(
        {
            "uid": user.pk,
            "username": user.username,
            "fp": _token_fingerprint(user),
        },
        salt=TOKEN_SALT,
        compress=True,
    )


def _bearer_token(request):
    header = authentication.get_authorization_header(request).decode("utf-8")
    if not header:
        return ""
    parts = header.split()
    if len(parts) != 2 or parts[0].lower() not in {"bearer", "token"}:
        return ""
    return parts[1].strip()


class CompanyUserTokenAuthentication(authentication.BaseAuthentication):
    keyword = "Bearer"

    def authenticate_header(self, request):
        return self.keyword

    def authenticate(self, request):
        token = _bearer_token(request)
        if not token:
            return None

        try:
            payload = signing.loads(
                token,
                salt=TOKEN_SALT,
                max_age=getattr(settings, "API_SESSION_SECONDS", 12 * 60 * 60),
            )
        except signing.SignatureExpired as error:
            raise exceptions.AuthenticationFailed("Your sign-in expired. Please sign in again.") from error
        except signing.BadSignature as error:
            raise exceptions.AuthenticationFailed("Invalid sign-in token.") from error

        from .models import CompanyUser

        user = (
            CompanyUser.objects.select_related("role")
            .filter(pk=payload.get("uid"), active=True)
            .first()
        )
        if not user:
            raise exceptions.AuthenticationFailed("This user is no longer active.")
        if str(user.username).lower() != str(payload.get("username") or "").lower():
            raise exceptions.AuthenticationFailed("Invalid sign-in token.")
        if not constant_time_compare(payload.get("fp", ""), _token_fingerprint(user)):
            raise exceptions.AuthenticationFailed("Your sign-in changed. Please sign in again.")

        request.company_user = user
        return user, token


class IsAdminCompanyUser(permissions.BasePermission):
    message = "Only an active Admin user can perform this action."

    def has_permission(self, request, view):
        user = company_user_from_request(request)
        return bool(user and str(getattr(user.role, "name", "")).lower() == "admin")


def user_has_resource_access(user, resource_key):
    if not user or not resource_key:
        return False
    role = getattr(user, "role", None)
    role_name = str(getattr(role, "name", "") or "").lower()
    if role_name == "admin":
        return True
    keys = getattr(role, "allowed_resource_keys", None) or []
    return "*" in keys or resource_key in keys


def request_user_has_resource_access(request, resource_key):
    return user_has_resource_access(company_user_from_request(request), resource_key)


def resource_access_denied_response(request, detail):
    if company_user_from_request(request):
        return Response({"detail": detail}, status=status.HTTP_403_FORBIDDEN)
    return Response(
        {"detail": "Authentication credentials were not provided."},
        status=status.HTTP_401_UNAUTHORIZED,
        headers={"WWW-Authenticate": "Bearer"},
    )


class HasCompanyResourceAccess(permissions.BasePermission):
    message = "You do not have access to this screen."

    def resource_keys_for_request(self, request, view):
        basename = getattr(view, "basename", "")
        if basename in RESOURCE_KEYS_BY_BASENAME:
            return RESOURCE_KEYS_BY_BASENAME[basename]

        path = str(getattr(request, "path_info", "") or getattr(request, "path", "") or "")
        if path.startswith("/api/data-import/"):
            return ("data-import",)
        if path.startswith("/api/live-footage/"):
            return ("live-footage",)
        return ()

    def has_permission(self, request, view):
        if not getattr(settings, "API_AUTH_REQUIRED", True):
            return True

        user = company_user_from_request(request)
        if not user:
            return False

        resource_keys = self.resource_keys_for_request(request, view)
        if not resource_keys:
            return True

        return any(user_has_resource_access(user, key) for key in resource_keys)


def company_user_from_request(request):
    user = getattr(request, "company_user", None)
    if user:
        return user
    user = getattr(request, "user", None)
    if getattr(user, "is_authenticated", False):
        return user

    if getattr(settings, "API_AUTH_REQUIRED", True):
        return None

    user_id = str(request.META.get("HTTP_X_COMPANY_USER_ID") or "").strip()
    username = str(request.META.get("HTTP_X_COMPANY_USERNAME") or "").strip()
    if not user_id and not username:
        return None

    from .models import CompanyUser

    queryset = CompanyUser.objects.select_related("role").filter(active=True)
    if user_id.isdigit():
        queryset = queryset.filter(pk=int(user_id))
    elif username:
        queryset = queryset.filter(username__iexact=username)

    user = queryset.first()
    if user and username and user.username.lower() != username.lower():
        return None
    return user


def request_user_is_admin(request):
    user = company_user_from_request(request)
    return bool(user and str(getattr(user.role, "name", "")).lower() == "admin")
