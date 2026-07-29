import io
import struct
import sys
from pathlib import Path

from PIL import Image


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


PROJECT_ROOT = Path(__file__).resolve().parent.parent
SOURCE = PROJECT_ROOT / "assets" / "generated" / "icon-source.png"
ICON_ROOT = PROJECT_ROOT / "assets" / "generated" / "icons"
OUTPUT = PROJECT_ROOT / "build" / "icon.ico"
ICO_SIZES = [16, 20, 24, 30, 32, 36, 40, 48, 64, 128, 256]


def png_bytes(path: Path) -> bytes:
    with Image.open(path) as image:
        buffer = io.BytesIO()
        image.convert("RGBA").save(buffer, format="PNG")
        return buffer.getvalue()


def write_ico(images: list[tuple[int, bytes]]) -> None:
    header_size = 6 + 16 * len(images)
    offset = header_size
    entries: list[bytes] = []
    payloads: list[bytes] = []
    for size, payload in images:
        dimension = 0 if size >= 256 else size
        entries.append(
            struct.pack(
                "<BBBBHHII",
                dimension,
                dimension,
                0,
                0,
                1,
                32,
                len(payload),
                offset,
            )
        )
        payloads.append(payload)
        offset += len(payload)

    with OUTPUT.open("wb") as stream:
        stream.write(struct.pack("<HHH", 0, 1, len(images)))
        stream.writelines(entries)
        stream.writelines(payloads)


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit("缺少生成后的图标源文件，请先运行 npm run prepare:assets")

    icon_paths = [(size, ICON_ROOT / f"tangmao-{size}.png") for size in ICO_SIZES]
    missing = [path for _size, path in icon_paths if not path.exists()]
    if missing:
        raise SystemExit("缺少生成后的多尺寸图标，请先运行 npm run prepare:assets")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    write_ico([(size, png_bytes(path)) for size, path in icon_paths])
    print(f"已生成图标：{OUTPUT}")


if __name__ == "__main__":
    main()
