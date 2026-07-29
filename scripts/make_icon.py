from pathlib import Path

from PIL import Image


PROJECT_ROOT = Path(__file__).resolve().parent.parent
SOURCE = PROJECT_ROOT / "assets" / "generated" / "icon-source.png"
OUTPUT = PROJECT_ROOT / "build" / "icon.ico"


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit("缺少生成后的图标源文件，请先运行 npm run prepare:assets")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    image = Image.open(SOURCE).convert("RGBA")
    image.save(
        OUTPUT,
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(f"已生成图标：{OUTPUT}")


if __name__ == "__main__":
    main()
