from abc import ABC, abstractmethod
from pathlib import Path
from tempfile import NamedTemporaryFile

from flask import current_app


class UploadStorage(ABC):
    provider_name = "unknown"

    @abstractmethod
    def save(self, key, content):
        raise NotImplementedError

    @abstractmethod
    def read(self, key):
        raise NotImplementedError

    @abstractmethod
    def delete(self, key):
        raise NotImplementedError

    @abstractmethod
    def exists(self, key):
        raise NotImplementedError


class LocalUploadStorage(UploadStorage):
    provider_name = "local"

    def __init__(self, root_directory):
        self.root_directory = Path(root_directory).expanduser().resolve()

    def _resolve_key(self, key):
        normalized = str(key or "").replace("\\", "/").lstrip("/")
        candidate = (self.root_directory / normalized).resolve()
        try:
            candidate.relative_to(self.root_directory)
        except ValueError as error:
            raise ValueError("Upload storage key is invalid.") from error
        if not normalized or normalized in {".", ".."}:
            raise ValueError("Upload storage key is invalid.")
        return candidate

    def save(self, key, content):
        destination = self._resolve_key(key)
        destination.parent.mkdir(parents=True, exist_ok=True)
        with NamedTemporaryFile(
            dir=destination.parent,
            prefix=".upload-",
            delete=False,
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)
            temporary_file.write(content)
        try:
            temporary_path.replace(destination)
        except Exception:
            temporary_path.unlink(missing_ok=True)
            raise

    def read(self, key):
        return self._resolve_key(key).read_bytes()

    def delete(self, key):
        self._resolve_key(key).unlink(missing_ok=True)

    def exists(self, key):
        return self._resolve_key(key).is_file()


def get_upload_storage():
    storage = current_app.extensions.get("upload_storage")
    if storage is not None:
        return storage

    provider = str(
        current_app.config.get("UPLOAD_STORAGE_PROVIDER", "local")
    ).strip().lower()
    if provider == "local":
        storage = LocalUploadStorage(current_app.config["UPLOAD_DIRECTORY"])
    else:
        raise RuntimeError(
            f"Unsupported upload storage provider: {provider}. "
            "Configure a provider adapter before using it."
        )
    current_app.extensions["upload_storage"] = storage
    return storage

