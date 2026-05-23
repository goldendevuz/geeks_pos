from django.contrib.auth import authenticate
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.models import User
from django.middleware.csrf import get_token
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.authtoken.models import Token
from accounts.models import Role
from core.permissions import IsAdminOrOwner


def _resolve_role(user) -> str:
    # Superuser should behave as top-level manager in UI/API checks.
    if getattr(user, "is_superuser", False):
        return str(Role.OWNER)
    profile = getattr(user, "profile", None)
    raw_role = getattr(profile, "role", Role.CASHIER) or Role.CASHIER
    role = str(raw_role).upper()
    if role in {Role.CASHIER, Role.ADMIN, Role.OWNER}:
        return str(role)
    return str(Role.CASHIER)


def _token_login_payload(user: User) -> dict:
    token, _ = Token.objects.get_or_create(user=user)
    return {
        "token": token.key,
        "user": {
            "username": user.username,
            "role": _resolve_role(user),
        },
    }


class CsrfView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"csrfToken": get_token(request)})


class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        username = request.data.get("username")
        password = request.data.get("password")
        user = authenticate(request, username=username, password=password)
        if not user:
            return Response(
                {"code": "INVALID_CREDENTIALS", "detail": "Invalid credentials"}, status=400
            )
        return Response(_token_login_payload(user))


class PinUsersView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        rows = []
        for user in User.objects.filter(is_active=True).select_related("profile").order_by("username"):
            role = _resolve_role(user)
            profile = getattr(user, "profile", None)
            pin_enabled = bool(profile and profile.pin_enabled)
            if not pin_enabled:
                continue
            rows.append(
                {
                    "username": user.username,
                    "display_name": user.get_full_name() or user.username,
                    "role": role,
                    "pin_enabled": pin_enabled,
                }
            )
        return Response({"results": rows})


class PinLoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        username = (request.data.get("username") or "").strip()
        pin = str(request.data.get("pin") or "").strip()
        if not username or len(pin) != 4 or not pin.isdigit():
            return Response({"code": "INVALID_PIN", "detail": "pin must be 4 digits"}, status=400)
        try:
            user = User.objects.select_related("profile").get(username=username, is_active=True)
        except User.DoesNotExist:
            return Response({"code": "INVALID_CREDENTIALS", "detail": "Invalid credentials"}, status=400)
        profile = getattr(user, "profile", None)
        if not profile or not profile.pin_enabled or not profile.pin_hash:
            return Response({"code": "PIN_NOT_SET", "detail": "PIN is not configured"}, status=400)
        if not check_password(pin, profile.pin_hash):
            return Response({"code": "INVALID_PIN", "detail": "PIN mismatch"}, status=400)
        return Response(_token_login_payload(user))


class SetUserPinView(APIView):
    permission_classes = [IsAuthenticated, IsAdminOrOwner]

    def post(self, request):
        username = (request.data.get("username") or "").strip()
        pin = str(request.data.get("pin") or "").strip()
        enabled = bool(request.data.get("enabled", True))
        if not username:
            return Response({"code": "USERNAME_REQUIRED"}, status=400)
        if enabled and (len(pin) != 4 or not pin.isdigit()):
            return Response({"code": "INVALID_PIN", "detail": "pin must be 4 digits"}, status=400)
        try:
            user = User.objects.select_related("profile").get(username=username)
        except User.DoesNotExist:
            return Response({"code": "USER_NOT_FOUND"}, status=404)
        profile = getattr(user, "profile", None)
        if not profile:
            return Response({"code": "PROFILE_NOT_FOUND"}, status=404)
        profile.pin_enabled = enabled
        profile.pin_hash = make_password(pin) if enabled else ""
        profile.save(update_fields=["pin_enabled", "pin_hash"])
        return Response({"ok": True})


class LogoutView(APIView):
    def post(self, request):
        if getattr(request, "auth", None):
            request.auth.delete()
        return Response({"ok": True})


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        u = request.user
        role = _resolve_role(u)
        return Response({"username": u.username, "role": role})
