"""SharpPreviewGaussian node — interactive Gaussian preview with IMAGE output."""

import logging
import os
from pathlib import Path

import torch
from comfy_api.latest import io
from PIL import Image

from .image_utils import pil_to_comfy

log = logging.getLogger("sharp")

try:
    import folder_paths

    COMFYUI_OUTPUT_FOLDER = folder_paths.get_output_directory()
    COMFYUI_TEMP_FOLDER = folder_paths.get_temp_directory()
except (ImportError, AttributeError):
    COMFYUI_OUTPUT_FOLDER = None
    COMFYUI_TEMP_FOLDER = None


def _load_capture_tensor(capture_path: Path) -> torch.Tensor:
    """Load a PNG capture as ComfyUI IMAGE [1, H, W, 3] float32."""
    with Image.open(capture_path) as img:
        return pil_to_comfy(img.convert("RGB"))


class SharpPreviewGaussian(io.ComfyNode):
    """
    Preview Gaussian Splatting PLY files with an interactive viewer.

    Exposes an IMAGE output that mirrors the current 3D view (captured on each
    queue run via the browser widget). Camera orbit is preserved across runs
    when the upstream PLY path is unchanged.
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="SharpPreviewGaussian",
            display_name="Preview Gaussian (SHARP)",
            category="SHARP",
            description=(
                "Interactive 3D Gaussian splat preview with IMAGE output. "
                "Captures the current view angle each run; camera position is "
                "kept when the PLY path is unchanged."
            ),
            is_output_node=True,
            inputs=[
                io.String.Input(
                    "ply_path",
                    tooltip="Path to a Gaussian Splatting PLY file",
                    force_input=True,
                ),
                io.String.Input(
                    "background_color",
                    default="#000000",
                    tooltip="Background fill for captures (hex, e.g. #000000 or #ffffff)",
                ),
                io.Custom("EXTRINSICS").Input(
                    "extrinsics",
                    tooltip="4x4 camera extrinsics matrix for initial view",
                    optional=True,
                ),
                io.Custom("INTRINSICS").Input(
                    "intrinsics",
                    tooltip="3x3 camera intrinsics matrix for FOV",
                    optional=True,
                ),
            ],
            outputs=[
                io.Image.Output(display_name="image"),
            ],
        )

    @classmethod
    def fingerprint_inputs(cls, ply_path: str = "", background_color: str = "#000000",
                           extrinsics=None, intrinsics=None):
        """Re-execute whenever the capture file is updated (new camera angle or color change).

        Returns the capture file's modification time so ComfyUI detects changes made
        by the browser's auto-capture and forces a fresh execute() call.
        """
        if not ply_path or not COMFYUI_TEMP_FOLDER:
            return float("nan")
        stem = Path(ply_path).stem
        capture_path = Path(COMFYUI_TEMP_FOLDER) / f"sharp_gaussian_capture_{stem}.png"
        if capture_path.exists():
            return os.path.getmtime(capture_path)
        return float("nan")

    @classmethod
    def execute(
        cls,
        ply_path: str,
        background_color: str = "#000000",
        extrinsics=None,
        intrinsics=None,
    ):
        if not ply_path:
            log.info("No PLY path provided")
            return io.NodeOutput(
                torch.zeros(1, 64, 64, 3),
                ui={"error": ["No PLY path provided"]},
            )

        if not os.path.exists(ply_path):
            log.info("PLY file not found: %s", ply_path)
            return io.NodeOutput(
                torch.zeros(1, 64, 64, 3),
                ui={"error": [f"File not found: {ply_path}"]},
            )

        filename = os.path.basename(ply_path)

        if COMFYUI_OUTPUT_FOLDER and ply_path.startswith(COMFYUI_OUTPUT_FOLDER):
            relative_path = os.path.relpath(ply_path, COMFYUI_OUTPUT_FOLDER)
        else:
            relative_path = filename

        file_size = os.path.getsize(ply_path)
        file_size_mb = file_size / (1024 * 1024)

        stem = Path(ply_path).stem
        capture_filename = f"sharp_gaussian_capture_{stem}.png"

        if COMFYUI_TEMP_FOLDER:
            capture_path = Path(COMFYUI_TEMP_FOLDER) / capture_filename
            if capture_path.exists():
                image_tensor = _load_capture_tensor(capture_path)
                log.info("Loaded capture: %s", capture_path)
            else:
                image_tensor = torch.zeros(1, 64, 64, 3)
                log.info("No capture yet at %s (first run or after camera move)", capture_path)
        else:
            image_tensor = torch.zeros(1, 64, 64, 3)

        bg = background_color.strip() if background_color else "#000000"
        if not bg.startswith("#"):
            bg = f"#{bg}"

        log.info("Loading PLY: %s (%.2f MB)", filename, file_size_mb)

        ui_data = {
            "ply_file": [relative_path],
            "filename": [filename],
            "file_size_mb": [round(file_size_mb, 2)],
            "background_color": [bg],
            "capture_filename": [capture_filename],
        }

        if extrinsics is not None:
            ui_data["extrinsics"] = [extrinsics]
        if intrinsics is not None:
            ui_data["intrinsics"] = [intrinsics]

        return io.NodeOutput(image_tensor, ui=ui_data)


NODE_CLASS_MAPPINGS = {
    "SharpPreviewGaussian": SharpPreviewGaussian,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SharpPreviewGaussian": "Preview Gaussian (SHARP)",
}
