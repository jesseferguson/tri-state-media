import mimetypes
from pathlib import Path

from django.http import FileResponse

from .upload_security import safe_upload_name


def private_file_response(file_field, *, display_name="", fallback_name="file"):
    storage_name = getattr(file_field, "name", "").rsplit("/", 1)[-1]
    display_text = display_name or storage_name or fallback_name
    display_suffix = Path(display_text).suffix
    storage_suffix = Path(storage_name).suffix
    file_name = display_text if display_suffix else f"{display_text}{storage_suffix}"
    safe_file_name = safe_upload_name(file_name, fallback_name).replace('"', "").replace("\r", "").replace("\n", "")
    content_type = mimetypes.guess_type(file_name)[0] or mimetypes.guess_type(storage_name)[0] or "application/octet-stream"
    response = FileResponse(file_field.open("rb"), content_type=content_type)
    response["Content-Disposition"] = f'inline; filename="{safe_file_name}"'
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response
