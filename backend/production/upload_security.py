import mimetypes
from pathlib import Path

from django.conf import settings
from rest_framework import serializers


IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
PDF_CONTENT_TYPES = {"application/pdf", "application/x-pdf"}
MAX_UPLOAD_BYTES = int(getattr(settings, "MAX_UPLOAD_BYTES", 10 * 1024 * 1024))


def safe_upload_name(filename, fallback="upload"):
    name = Path(str(filename or "")).name.replace("\x00", "").strip()
    return name or fallback


def _detected_content_type(upload):
    content_type = str(getattr(upload, "content_type", "") or "").split(";", 1)[0].strip().lower()
    if content_type and content_type not in {"application/octet-stream", "binary/octet-stream"}:
        return content_type
    guessed, _encoding = mimetypes.guess_type(safe_upload_name(getattr(upload, "name", "")))
    return str(guessed or "").lower()


def _rewind(upload):
    try:
        upload.seek(0)
    except (AttributeError, OSError):
        pass


def _validate_image_payload(upload):
    from PIL import Image, UnidentifiedImageError

    try:
        with Image.open(upload) as image:
            image.verify()
    except (OSError, UnidentifiedImageError) as error:
        raise serializers.ValidationError("Upload a valid image file.") from error
    finally:
        _rewind(upload)


def _validate_pdf_payload(upload):
    try:
        header = upload.read(5)
    finally:
        _rewind(upload)
    if header != b"%PDF-":
        raise serializers.ValidationError("Upload a valid PDF file.")


def validate_upload(upload, *, allow_images=True, allow_pdf=False, field="file"):
    if not upload:
        raise serializers.ValidationError({field: ["Choose a file to upload."]})

    if getattr(upload, "size", 0) > MAX_UPLOAD_BYTES:
        raise serializers.ValidationError({field: [f"Upload a file smaller than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB."]})

    content_type = _detected_content_type(upload)
    image_allowed = allow_images and content_type in IMAGE_CONTENT_TYPES
    pdf_allowed = allow_pdf and content_type in PDF_CONTENT_TYPES
    if not image_allowed and not pdf_allowed:
        allowed = "image or PDF" if allow_pdf and allow_images else "image" if allow_images else "PDF"
        raise serializers.ValidationError({field: [f"Upload a valid {allowed} file."]})

    if image_allowed:
        _validate_image_payload(upload)
    elif pdf_allowed:
        _validate_pdf_payload(upload)

    upload.name = safe_upload_name(upload.name)
    return upload
