from django.conf import settings
from django.core import signing
from django.utils.crypto import constant_time_compare, salted_hmac
from rest_framework import authentication, exceptions, permissions


TOKEN_SALT = "tri-state-media.company-user-token"
TOKEN_FINGERPRINT_SALT = "tri-state-media.company-user-token-fingerprint"


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


def company_user_from_request(request):
    user = getattr(request, "company_user", None)
    if user:
        return user
    user = getattr(request, "user", None)
    if getattr(user, "is_authenticated", False):
        return user

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
