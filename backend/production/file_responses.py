import mimetypes

from django.http import FileResponse

from .upload_security import safe_upload_name


def private_file_response(file_field, *, display_name="", fallback_name="file"):
    file_name = display_name or getattr(file_field, "name", "").rsplit("/", 1)[-1] or fallback_name
    safe_file_name = safe_upload_name(file_name, fallback_name).replace('"', "").replace("\r", "").replace("\n", "")
    content_type = mimetypes.guess_type(file_name)[0] or "application/octet-stream"
    response = FileResponse(file_field.open("rb"), content_type=content_type)
    response["Content-Disposition"] = f'inline; filename="{safe_file_name}"'
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response
