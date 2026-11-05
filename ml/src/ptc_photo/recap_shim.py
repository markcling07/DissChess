"""A small stand-in for the parts of `recap` that chesscog uses.

recap 0.1.8 imports a private pathlib class that Python 3.12 removed, so it can't load here.
chesscog only needs path prefixes like "config://" and YAML configuration objects.
"""

import importlib.machinery
import sys
import types
from pathlib import Path

from yacs.config import CfgNode as _YacsNode

_translators: dict[str, Path] = {}


def register_translator(scheme: str, path: Path) -> None:
    _translators[scheme] = Path(path)


def URI(uri) -> Path:  # noqa: N802 - keeps the name chesscog imports
    text = str(uri)
    scheme, separator, rest = text.partition("://")
    if separator and scheme in _translators:
        return _translators[scheme] / rest
    return Path(text)


class CfgNode(_YacsNode):
    def __init__(self, init_dict=None, key_list=None, new_allowed=False):
        def convert(item):
            return (
                CfgNode(item)
                if isinstance(item, dict) and not isinstance(item, _YacsNode)
                else item
            )

        if init_dict is not None:
            init_dict = {
                key: list(map(convert, value)) if isinstance(value, list) else value
                for key, value in init_dict.items()
            }
        super().__init__(init_dict=init_dict, key_list=key_list, new_allowed=new_allowed)

    @classmethod
    def load_yaml_with_base(cls, filename) -> "CfgNode":
        path = URI(filename)
        with path.open("r", encoding="utf-8") as file:
            config = cls.load_cfg(file)
        if "_BASE_" in config:
            base = URI(config["_BASE_"])
            if not base.is_absolute():
                base = path.parent / base
            merged = cls.load_yaml_with_base(base)
            del config["_BASE_"]
            merged.set_new_allowed(True)
            merged.merge_from_other_cfg(config)
            return merged
        return config


def install() -> None:
    """Makes `import recap` find this module."""
    recap = types.ModuleType("recap")
    recap.URI = URI
    recap.CfgNode = CfgNode
    path_manager = types.ModuleType("recap.path_manager")
    path_manager.register_translator = register_translator
    path_manager.URI = URI
    recap.path_manager = path_manager
    sys.modules["recap"] = recap
    sys.modules["recap.path_manager"] = path_manager

    # chesscog imports these for downloading, which this comparison never does. Stubbing them means
    # its download code can't reach the network even by accident.
    drive = types.ModuleType("google_drive_downloader")
    drive.GoogleDriveDownloader = None
    sys.modules["google_drive_downloader"] = drive
    sys.modules["requests"] = types.ModuleType("requests")
    progress = types.ModuleType("tqdm")
    progress.tqdm = lambda iterable=None, *args, **kwargs: iterable
    sys.modules["tqdm"] = progress
    # Other libraries inspect the modules they find, so these need to look like real ones.
    for name in ("recap", "recap.path_manager", "google_drive_downloader", "requests", "tqdm"):
        sys.modules[name].__spec__ = importlib.machinery.ModuleSpec(name, None)
