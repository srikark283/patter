import sys
from PIL import Image

img = Image.open("docs/logo.png").convert("RGBA")
w, h = img.size

# Let's print the colors of a row from the middle (x=0 to 256, y=128)
row = []
for x in range(30):
    row.append(img.getpixel((x, 128)))
print("Left edge going in:")
for i, p in enumerate(row):
    print(f"x={i}: {p}")

