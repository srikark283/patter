import sys
from PIL import Image

img = Image.open("docs/logo.png").convert("RGBA")
w, h = img.size

# Fill transparent pixels with black
for y in range(h):
    for x in range(w):
        r, g, b, a = img.getpixel((x, y))
        if a == 0:
            img.putpixel((x, y), (0, 0, 0, 255))
        elif a < 255:
            # Blend with black
            bg_r, bg_g, bg_b = 0, 0, 0
            new_r = int((r * a + bg_r * (255 - a)) / 255)
            new_g = int((g * a + bg_g * (255 - a)) / 255)
            new_b = int((b * a + bg_b * (255 - a)) / 255)
            img.putpixel((x, y), (new_r, new_g, new_b, 255))

img.save("src-tauri/icons/app-icon-opaque.png")
print("Saved opaque square icon to src-tauri/icons/app-icon-opaque.png")
