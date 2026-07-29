from pathlib import Path

from PIL import Image


PROJECT_ROOT = Path(__file__).resolve().parent.parent
SOURCE = PROJECT_ROOT / "糖猫合集" / "站.png"
OUTPUT = PROJECT_ROOT / "build" / "icon.ico"


def main() -> None:
    source = Image.open(SOURCE).convert("RGBA")
    canvas_size = 256
    padding = 14
    max_size = canvas_size - padding * 2
    scale = min(max_size / source.width, max_size / source.height)
    resized = source.resize(
        (round(source.width * scale), round(source.height * scale)),
        Image.Resampling.LANCZOS,
    )

    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    position = (
        (canvas_size - resized.width) // 2,
        canvas_size - resized.height - padding,
    )
    canvas.alpha_composite(resized, position)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(
        OUTPUT,
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(OUTPUT)


if __name__ == "__main__":
    main()
